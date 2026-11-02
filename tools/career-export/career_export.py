# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "frida",
# ]
# ///
"""Export a running career in umadump's career payload format.

Reads a live Umamusume career off the skill-learning screen and writes the same
API-shaped document umadump emits: `{"single_mode_load_common": {...}}`, keyed
and ordered like a `single_mode/load` response so a capture from this script and
a capture from umadump are the same file.

Field offsets are resolved by metadata field name at runtime, the way umadump
does it, rather than by hardcoded offsets or getter names.

This script reads the trainee and the race history and nothing else. Every other
section is a documented placeholder: see "What is read" in README.md before
trusting a key, and note that the scenario data set (`free_data_set` and
friends) is absent rather than empty.

Usage:
    uv run career_export.py [--out career-export.json] [--debug]

Then, in game, open the skill-learning screen of an active career. The hook
fires on `BeginView`, the file is written, and the script exits.

On Linux the client is a Windows PE running under Proton or Wine. A plain
Frida attach would inject Frida's Linux agent into that process and crash it,
so the script detects the Wine prefix, starts a Windows `frida-server` inside
it, and attaches through that. The server binary is downloaded once and cached
under `~/.cache/career-export/`; pass `--frida-server` to reuse one, or
`--wine-prefix` / `--remote` to point at a prefix or server explicitly.

Field offsets come from the IL2CPP class table at runtime, keyed by metadata
field name, following Werseter/umadump (github.com/Werseter/umadump). The
payload contract is that project's `decode_career_data`.
"""

import argparse
import json
import logging
import lzma
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import frida

# --- Config ----------------------------------------------------------------

TARGET_PROCESS_NAMES = ["UmamusumePrettyDerby.exe", "UmamusumePrettyDerby"]
PROCESS_KEYWORDS = ["uma", "musume", "derby", "cygames"]
MAX_WAIT_SECONDS = 3600
WINE_SERVER_WAIT_SECONDS = 60
FRIDA_SERVER_CACHE = os.path.join(os.path.expanduser("~"), ".cache", "career-export")

_parser = argparse.ArgumentParser(description="Career exporter")
_parser.add_argument("--out", default="career-export.json", help="Output path")
_parser.add_argument("--debug", action="store_true", help="Write career_export.log")
_parser.add_argument(
    "--wine-prefix", metavar="PATH",
    help="Attach through a Wine/Proton prefix (auto-detected on Linux)",
)
_parser.add_argument(
    "--wine-binary", metavar="PATH",
    help="Wine loader to run the Windows frida-server with",
)
_parser.add_argument(
    "--frida-server", metavar="PATH",
    help="Existing Windows frida-server.exe to use instead of downloading one",
)
_parser.add_argument(
    "--remote", metavar="HOST:PORT",
    help="Attach through an already-running frida-server",
)
_args = _parser.parse_args()

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.abspath(_args.out)

logger = logging.getLogger("career_export")
logger.setLevel(logging.DEBUG)
if _args.debug:
    _fh = logging.FileHandler(os.path.join(_SCRIPT_DIR, "career_export.log"), mode="w", encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_fh)
_ch = logging.StreamHandler(sys.stdout)
_ch.setLevel(logging.INFO)
_ch.setFormatter(logging.Formatter("%(message)s"))
logger.addHandler(_ch)


def log(msg=""):
    logger.info(str(msg))


# --- Injected script -------------------------------------------------------

FRIDA_SCRIPT = r"""
(function() {
    "use strict";

    const ptrSize = Process.pointerSize;

    const GA_NAMES = [
        "GameAssembly.dll", "GameAssembly",
        "libil2cpp.so", "UnityFramework", "GameAssembly.dylib",
    ];

    let gaMod = null;
    for (const name of GA_NAMES) {
        try { gaMod = Process.getModuleByName(name); if (gaMod) break; } catch(e) {}
    }
    if (!gaMod) {
        send({ type: "error", message: "GameAssembly not found" });
        return;
    }

    function resolve(name) {
        try {
            if (typeof gaMod.findExportByName === 'function')
                return gaMod.findExportByName(name) || null;
        } catch(e) {}
        try { return Module.findExportByName(gaMod.name, name) || null; } catch(e) {}
        return null;
    }

    const api = {};
    for (const n of [
        "il2cpp_domain_get", "il2cpp_domain_get_assemblies",
        "il2cpp_assembly_get_image", "il2cpp_image_get_class_count",
        "il2cpp_image_get_class", "il2cpp_class_get_name",
        "il2cpp_class_get_namespace", "il2cpp_class_get_methods",
        "il2cpp_class_get_fields", "il2cpp_class_get_nested_types",
        "il2cpp_class_get_parent",
        "il2cpp_method_get_name", "il2cpp_method_get_param_count",
        "il2cpp_field_get_name", "il2cpp_field_get_offset", "il2cpp_field_get_flags",
    ]) api[n] = resolve(n);

    for (const required of ["il2cpp_domain_get", "il2cpp_class_get_methods"]) {
        if (!api[required]) {
            send({ type: "error", message: "Missing IL2CPP export: " + required });
            return;
        }
    }

    const fn = {
        domain_get:            new NativeFunction(api.il2cpp_domain_get, "pointer", []),
        domain_get_assemblies: new NativeFunction(api.il2cpp_domain_get_assemblies, "pointer", ["pointer", "pointer"]),
        assembly_get_image:    new NativeFunction(api.il2cpp_assembly_get_image, "pointer", ["pointer"]),
        image_get_class_count: new NativeFunction(api.il2cpp_image_get_class_count, "uint32", ["pointer"]),
        image_get_class:       new NativeFunction(api.il2cpp_image_get_class, "pointer", ["pointer", "uint32"]),
        class_get_name:        new NativeFunction(api.il2cpp_class_get_name, "pointer", ["pointer"]),
        class_get_namespace:   new NativeFunction(api.il2cpp_class_get_namespace, "pointer", ["pointer"]),
        class_get_methods:     new NativeFunction(api.il2cpp_class_get_methods, "pointer", ["pointer", "pointer"]),
        method_get_name:       new NativeFunction(api.il2cpp_method_get_name, "pointer", ["pointer"]),
        method_get_param_count: api.il2cpp_method_get_param_count
            ? new NativeFunction(api.il2cpp_method_get_param_count, "uint32", ["pointer"]) : null,
        class_get_fields: api.il2cpp_class_get_fields
            ? new NativeFunction(api.il2cpp_class_get_fields, "pointer", ["pointer", "pointer"]) : null,
        field_get_name: api.il2cpp_field_get_name
            ? new NativeFunction(api.il2cpp_field_get_name, "pointer", ["pointer"]) : null,
        field_get_offset: api.il2cpp_field_get_offset
            ? new NativeFunction(api.il2cpp_field_get_offset, "int32", ["pointer"]) : null,
        class_get_nested_types: api.il2cpp_class_get_nested_types
            ? new NativeFunction(api.il2cpp_class_get_nested_types, "pointer", ["pointer", "pointer"]) : null,
        class_get_parent: api.il2cpp_class_get_parent
            ? new NativeFunction(api.il2cpp_class_get_parent, "pointer", ["pointer"]) : null,
        field_get_flags: api.il2cpp_field_get_flags
            ? new NativeFunction(api.il2cpp_field_get_flags, "uint32", ["pointer"]) : null,
    };

    function readCStr(p) {
        if (!p || p.isNull()) return "";
        try { return p.readUtf8String(); } catch(e) { return ""; }
    }

    // IL2CPP List<T>: items array at 0x10, count at 0x18.
    function readListCount(listPtr) {
        if (!listPtr || listPtr.isNull()) return 0;
        try { return listPtr.add(0x18).readS32(); } catch(e) { return 0; }
    }
    function readListItemsArray(listPtr) {
        if (!listPtr || listPtr.isNull()) return null;
        try { return listPtr.add(0x10).readPointer(); } catch(e) { return null; }
    }
    // IL2CPP array: length at 0x18, elements from 0x20.
    function readArrayLength(arrPtr) {
        if (!arrPtr || arrPtr.isNull()) return 0;
        try { return arrPtr.add(0x18).readU32(); } catch(e) { return 0; }
    }
    function readArrayElement(arrPtr, index) {
        if (!arrPtr || arrPtr.isNull()) return null;
        try { return arrPtr.add(0x20 + index * ptrSize).readPointer(); } catch(e) { return null; }
    }
    // ACTk ObscuredInt is {currentCryptoKey, hiddenValue, inited, fakeValue,
    // fakeValueActive}; the plaintext is the xor of the first two. That xor is
    // also correct for the stripped 8-byte variant that drops the trailing
    // fields, so no scalar read depends on the struct's total size.
    function readObscuredIntAt(base, offset) {
        const key = base.add(offset).readS32();
        const hidden = base.add(offset + 4).readS32();
        return (hidden ^ key) | 0;
    }

    // --- Class scan --------------------------------------------------------

    // The trainee and career roots plus every type the payload reaches into.
    // Field names and offsets come from this scan, so a class missing here
    // shows up as a null field rather than a wrong number.
    const TARGET_CLASSES = [
        "Gallop.SingleModeSkillLearningViewController",
        "Gallop.WorkSingleModeData",
        "Gallop.WorkSingleModeCharaData",
        "Gallop.WorkSingleModeCharaData.SkillTips",
        "Gallop.WorkSingleModeCharaData.EquipSupportCard",
        "Gallop.WorkSingleModeCharaData.SuccessionCharaInfo",
        "Gallop.WorkSingleModeData.RaceCondition",
        "Gallop.WorkSkillData.AcquiredSkill",
        "Gallop.SingleModeUtils.RaceHistoryInfo",
        "Gallop.MasterSingleModeWinsSaddle.SingleModeWinsSaddle",
    ];
    const targetLookup = {};
    for (const t of TARGET_CLASSES) targetLookup[t] = true;

    const targets = {};

    function getNestedTypes(classPtr) {
        if (!fn.class_get_nested_types) return [];
        const nested = [];
        try {
            const iter = Memory.alloc(ptrSize);
            iter.writePointer(ptr(0));
            for (let i = 0; i < 50; i++) {
                const nt = fn.class_get_nested_types(classPtr, iter);
                if (nt.isNull()) break;
                nested.push(nt);
            }
        } catch(e) {}
        return nested;
    }

    // Metadata spells an auto-property `<Speed>k__BackingField`. umadump keys
    // its wrappers by the camelCase form, so normalise the same way and the
    // field names below stay identical to that project's.
    function normalizeFieldName(raw) {
        let name = raw.replace(/^_+/, "");
        const backing = name.match(/^<_?([^>]+)>k__BackingField$/);
        if (backing) name = backing[1];
        return name ? name[0].toLowerCase() + name.slice(1) : "";
    }

    // Instance fields of a class and its bases. il2cpp_class_get_fields reports
    // only what a class declares, and several types the payload reaches into
    // inherit theirs -- AcquiredSkill takes masterId and level from
    // SkillDataBase -- so walk the chain.
    const FIELD_ATTRIBUTE_STATIC = 0x0010;

    function collectFields(classPtr) {
        const fields = {};
        let current = classPtr;
        for (let depth = 0; depth < 16; depth++) {
            if (!current || current.isNull()) break;
            const iter = Memory.alloc(ptrSize);
            iter.writePointer(ptr(0));
            for (let i = 0; i < 400; i++) {
                const field = fn.class_get_fields(current, iter);
                if (field.isNull()) break;
                if (fn.field_get_flags && (fn.field_get_flags(field) & FIELD_ATTRIBUTE_STATIC)) continue;
                const name = normalizeFieldName(readCStr(fn.field_get_name(field)));
                const offset = fn.field_get_offset(field);
                if (name && offset > 0 && !(name in fields)) fields[name] = offset;
            }
            current = fn.class_get_parent ? fn.class_get_parent(current) : null;
        }
        return fields;
    }

    function processClass(classPtr, parentName) {
        const name = readCStr(fn.class_get_name(classPtr));
        const ns = readCStr(fn.class_get_namespace(classPtr));
        const fullName = parentName ? `${parentName}.${name}` : (ns ? `${ns}.${name}` : name);

        if (targetLookup[fullName] || targetLookup[name]) {
            const classInfo = { fullName, methods: {}, fields: {} };

            const iter = Memory.alloc(ptrSize);
            iter.writePointer(ptr(0));
            for (let i = 0; i < 800; i++) {
                const method = fn.class_get_methods(classPtr, iter);
                if (method.isNull()) break;
                const mName = readCStr(fn.method_get_name(method));
                const paramCount = fn.method_get_param_count ? fn.method_get_param_count(method) : -1;
                let compiled = ptr(0);
                try { compiled = method.readPointer(); } catch(e) {}
                classInfo.methods[mName] = classInfo.methods[mName] || [];
                classInfo.methods[mName].push({ paramCount, compiledAddr: compiled.toString() });
            }

            if (fn.class_get_fields && fn.field_get_name && fn.field_get_offset) {
                classInfo.fields = collectFields(classPtr);
            }

            targets[fullName] = classInfo;
            console.log(`  Found class: ${fullName}`);
        }

        for (const nt of getNestedTypes(classPtr)) processClass(nt, fullName);
    }

    const domain = fn.domain_get();
    const countBuf = Memory.alloc(4);
    const assembliesPtr = fn.domain_get_assemblies(domain, countBuf);
    const asmCount = countBuf.readU32();

    for (let ai = 0; ai < asmCount; ai++) {
        const asmPtr = assembliesPtr.add(ai * ptrSize).readPointer();
        if (asmPtr.isNull()) continue;
        const image = fn.assembly_get_image(asmPtr);
        if (image.isNull()) continue;
        const classCount = fn.image_get_class_count(image);
        for (let ci = 0; ci < classCount; ci++) {
            let classPtr;
            try { classPtr = fn.image_get_class(image, ci); } catch(e) { continue; }
            if (!classPtr || classPtr.isNull()) continue;
            processClass(classPtr, null);
        }
    }

    function findMethod(className, methodName, paramCount) {
        const info = targets[className];
        if (!info) return null;
        const overloads = info.methods[methodName];
        if (!overloads) return null;
        if (paramCount >= 0) {
            const exact = overloads.find(o => o.paramCount === paramCount);
            if (exact) return exact;
        }
        return overloads[0];
    }

    function hookMethod(className, methodName, paramCount, callback) {
        const match = findMethod(className, methodName, paramCount);
        if (!match) {
            console.log(`  [SKIP] ${className}.${methodName} not found`);
            return false;
        }
        const addr = ptr(match.compiledAddr);
        if (addr.isNull()) return false;
        try {
            Interceptor.attach(addr, callback);
            console.log(`  [HOOK] ${className}.${methodName} @ ${addr}`);
            return true;
        } catch(e) {
            console.log(`  [FAIL] ${className}.${methodName}: ${e}`);
            return false;
        }
    }

    // --- Career state ------------------------------------------------------
    //
    // Rather than walk the WorkDataManager singleton, latch the live career off
    // the game's own traffic. This needs no static-field resolution, which
    // differs across IL2CPP builds.
    //
    // A hook only sees calls made after it is installed, so latching one getter
    // is not enough: attaching while the skill screen is already open misses
    // everything that screen read on the way in. BeginView therefore tolerates
    // the pointers still being cold rather than giving up on the run.

    let charaPtr = null;
    let singleModePtr = null;

    hookMethod("Gallop.WorkSingleModeData", "get_Character", 0, {
        onEnter(args) { singleModePtr = args[0]; },
        onLeave(retval) {
            if (retval && !retval.isNull()) charaPtr = ptr(retval.toString());
        }
    });

    // One hook is not enough to catch WorkSingleModeData. Its getters are not
    // called while a screen sits idle, and the skill screen reads the chara
    // from a reference it already holds rather than asking for it again, so
    // attaching mid-career can leave every single one of them unfired.
    //
    // Latch `this` from every no-arg getter on the class instead. Each handler
    // short-circuits once the pointer is set, so the cost is a null check on
    // methods that are only touched when a career screen actually updates.
    const singleModeInfo = targets["Gallop.WorkSingleModeData"];
    if (singleModeInfo) {
        for (const [name, overloads] of Object.entries(singleModeInfo.methods)) {
            if (!name.startsWith("get_")) continue;
            const zeroArg = overloads.find((o) => o.paramCount === 0);
            if (!zeroArg) continue;
            try {
                Interceptor.attach(ptr(zeroArg.compiledAddr), {
                    onEnter(args) { if (!singleModePtr) singleModePtr = args[0]; }
                });
            } catch(e) { /* a getter we cannot hook is not worth failing over */ }
        }
    }

    // Second chance at the trainee if WorkSingleModeData stayed quiet.
    hookMethod("Gallop.WorkSingleModeCharaData", "get_Speed", 0, {
        onEnter(args) { if (!charaPtr) charaPtr = args[0]; }
    });

    // --- Field reads -------------------------------------------------------
    //
    // Values are read by metadata field name, the way umadump reads them, so a
    // class that gains or moves a field shows up as a null read instead of a
    // number taken from the wrong slot. Metadata spells auto-properties as
    // `<Speed>k__BackingField`, so the field tables are keyed by the camelCase
    // form umadump uses.

    // Total size of ACTk's ObscuredInt: {currentCryptoKey, hiddenValue, inited,
    // fakeValue, fakeValueActive}. Scalars only need the first two, but an
    // array's stride is this size. A client built with the stripped 8-byte
    // variant would make every element after the first garbage in
    // `chara_effect_id_array` and `route_race_id_array`; this is the constant
    // to change if that is ever observed.
    const OBSCURED_INT_SIZE = 20;

    // A torn read can report a huge count and build a payload past Frida's
    // 128MiB IPC limit, which drops the message and hangs the game. Clamp.
    const MAX_ELEMENTS = 1024;

    const CHARA = "Gallop.WorkSingleModeCharaData";
    const CAREER = "Gallop.WorkSingleModeData";
    const SKILL = "Gallop.WorkSkillData.AcquiredSkill";
    const SKILL_TIPS = "Gallop.WorkSingleModeCharaData.SkillTips";
    const SUPPORT_CARD = "Gallop.WorkSingleModeCharaData.EquipSupportCard";
    const SUCCESSION = "Gallop.WorkSingleModeCharaData.SuccessionCharaInfo";
    const RACE_CONDITION = "Gallop.WorkSingleModeData.RaceCondition";
    const RACE_HISTORY = "Gallop.SingleModeUtils.RaceHistoryInfo";
    const WIN_SADDLE = "Gallop.MasterSingleModeWinsSaddle.SingleModeWinsSaddle";

    function fieldOffset(className, fieldName) {
        const info = targets[className];
        if (!info) return null;
        const offset = info.fields[fieldName];
        return offset === undefined ? null : offset;
    }

    function readIntField(className, objectPtr, fieldName) {
        if (!objectPtr || objectPtr.isNull()) return null;
        const offset = fieldOffset(className, fieldName);
        if (offset === null) return null;
        try { return readObscuredIntAt(objectPtr, offset); } catch(e) { return null; }
    }

    // For plain int fields; only the win-saddle id is not obscured.
    function readPlainIntField(className, objectPtr, fieldName) {
        if (!objectPtr || objectPtr.isNull()) return null;
        const offset = fieldOffset(className, fieldName);
        if (offset === null) return null;
        try { return objectPtr.add(offset).readS32(); } catch(e) { return null; }
    }

    function readPtrField(className, objectPtr, fieldName) {
        if (!objectPtr || objectPtr.isNull()) return null;
        const offset = fieldOffset(className, fieldName);
        if (offset === null) return null;
        try { return objectPtr.add(offset).readPointer(); } catch(e) { return null; }
    }

    function arrayPointers(arrayPtr) {
        const out = [];
        if (!arrayPtr || arrayPtr.isNull()) return out;
        const length = readArrayLength(arrayPtr);
        if (length <= 0 || length > MAX_ELEMENTS) return out;
        for (let i = 0; i < length; i++) {
            const item = readArrayElement(arrayPtr, i);
            if (item && !item.isNull()) out.push(item);
        }
        return out;
    }

    function listPointers(listPtr) {
        const out = [];
        if (!listPtr || listPtr.isNull()) return out;
        const count = readListCount(listPtr);
        if (count <= 0 || count > MAX_ELEMENTS) return out;
        const items = readListItemsArray(listPtr);
        for (let i = 0; i < count; i++) {
            const item = readArrayElement(items, i);
            if (item && !item.isNull()) out.push(item);
        }
        return out;
    }

    // ObscuredInt[]: the field points at an Il2CppArray of value-type elements.
    function intArrayField(className, objectPtr, fieldName) {
        const out = [];
        const array = readPtrField(className, objectPtr, fieldName);
        if (!array || array.isNull()) return out;
        const length = readArrayLength(array);
        if (length <= 0 || length > MAX_ELEMENTS) return out;
        for (let i = 0; i < length; i++) {
            try { out.push(readObscuredIntAt(array, 0x20 + i * OBSCURED_INT_SIZE)); }
            catch(e) { return out; }
        }
        return out;
    }

    // List<ObscuredInt>: the list's backing array holds value-type elements.
    function intListField(className, objectPtr, fieldName) {
        const out = [];
        const list = readPtrField(className, objectPtr, fieldName);
        if (!list || list.isNull()) return out;
        const count = readListCount(list);
        if (count <= 0 || count > MAX_ELEMENTS) return out;
        const items = readListItemsArray(list);
        for (let i = 0; i < count; i++) {
            try { out.push(readObscuredIntAt(items, 0x20 + i * OBSCURED_INT_SIZE)); }
            catch(e) { return out; }
        }
        return out;
    }

    // --- Payload decoders --------------------------------------------------
    //
    // Keys, order and nesting follow umadump's `decode_career_data` so the two
    // tools emit the same document.

    function decodeCharaInfo(chara, turn, state, playingState) {
        const int = (name) => readIntField(CHARA, chara, name);

        const skillArray = listPointers(readPtrField(CHARA, chara, "acquiredSkillList")).map((skill) => ({
            skill_id: readIntField(SKILL, skill, "masterId"),
            level: readIntField(SKILL, skill, "level"),
        }));
        const skillTips = listPointers(readPtrField(CHARA, chara, "skillTipsList")).map((tip) => ({
            group_id: readIntField(SKILL_TIPS, tip, "groupId"),
            rarity: readIntField(SKILL_TIPS, tip, "rarity"),
            level: readIntField(SKILL_TIPS, tip, "level"),
        }));
        const supportCards = arrayPointers(readPtrField(CHARA, chara, "equipSupportCardArray")).map((card) => ({
            position: readIntField(SUPPORT_CARD, card, "position"),
            support_card_id: readIntField(SUPPORT_CARD, card, "supportCardId"),
            limit_break_count: readIntField(SUPPORT_CARD, card, "limitBreakCount"),
            exp: readIntField(SUPPORT_CARD, card, "exp"),
            // The owner is account state, which this script cannot observe.
            owner_viewer_id: 0,
        }));
        const successionId = (fieldName) => {
            const info = readPtrField(CHARA, chara, fieldName);
            return info && !info.isNull()
                ? readIntField(SUCCESSION, info, "trainedCharaId")
                : 0;
        };

        return {
            single_mode_chara_id: int("id"),
            card_id: int("cardId"),
            chara_grade: int("charaGrade"),
            speed: int("speed"),
            stamina: int("stamina"),
            power: int("power"),
            wiz: int("wiz"),
            guts: int("guts"),
            vital: int("hp"),
            max_speed: int("maxSpeed"),
            max_stamina: int("maxStamina"),
            max_power: int("maxPower"),
            max_wiz: int("maxWiz"),
            max_guts: int("maxGuts"),
            default_max_speed: int("defaultMaxSpeed"),
            default_max_stamina: int("defaultMaxStamina"),
            default_max_power: int("defaultMaxPower"),
            default_max_wiz: int("defaultMaxWiz"),
            default_max_guts: int("defaultMaxGuts"),
            max_vital: int("maxHp"),
            motivation: int("motivation"),
            fans: int("fanCount"),
            rarity: int("limitBreakCount"),
            race_program_id: int("entryProgramId"),
            reserve_race_program_id: int("reservedRaceProgramId"),
            race_running_style: int("runningStyle"),
            // ObscuredBool, whose layout this script does not read.
            is_short_race: 0,
            proper_ground_turf: int("properGroundTurf"),
            proper_ground_dirt: int("properGroundDirt"),
            proper_running_style_nige: int("properRunningStyleNige"),
            proper_running_style_senko: int("properRunningStyleSenko"),
            proper_running_style_sashi: int("properRunningStyleSashi"),
            proper_running_style_oikomi: int("properRunningStyleOikomi"),
            proper_distance_short: int("properDistanceShort"),
            proper_distance_mile: int("properDistanceMile"),
            proper_distance_middle: int("properDistanceMiddle"),
            proper_distance_long: int("properDistanceLong"),
            talent_level: int("talentLevel"),
            skill_array: skillArray,
            disable_skill_id_array: intListField(CHARA, chara, "disableSkillIdList"),
            skill_tips_array: skillTips,
            support_card_array: supportCards,
            succession_trained_chara_id_1: successionId("successionTrainedCharaInfoFirst"),
            succession_trained_chara_id_2: successionId("successionTrainedCharaInfoSecond"),
            turn: turn,
            skill_point: int("skillPoint"),
            short_cut_state: int("eventShortcutType"),
            state: state,
            playing_state: playingState,
            scenario_id: int("scenarioId"),
            route_id: int("routeId"),
            // ObscuredString, whose XOR-over-a-key-string layout is not read here.
            start_time: "",
            evaluation_info_array: [],
            training_level_info_array: [],
            nickname_id_array: intArrayField(CHARA, chara, "acquiredNickNameIdArray"),
            chara_effect_id_array: intArrayField(CHARA, chara, "charaEffectIdArray"),
            route_race_id_array: intArrayField(CHARA, chara, "routeRaceIdArray"),
            guest_outing_info_array: [],
            skill_upgrade_info_array: [],
        };
    }

    function decodeRaceHistory() {
        const int = (entry, name) => readIntField(RACE_HISTORY, entry, name);
        return listPointers(readPtrField(CAREER, singleModePtr, "raceHistoryInfoList")).map((entry) => ({
            turn: int(entry, "turn"),
            program_id: int(entry, "programId"),
            weather: int(entry, "weather"),
            ground_condition: int(entry, "groundCondition"),
            running_style: int(entry, "runningStyle"),
            result_rank: int(entry, "resultRank"),
            frame_order: int(entry, "frameOrder"),
            npc_count: int(entry, "npcCount"),
        }));
    }

    function decodeRaceConditions() {
        return listPointers(readPtrField(CAREER, singleModePtr, "raceConditions")).map((condition) => ({
            program_id: readIntField(RACE_CONDITION, condition, "programId"),
            weather: readIntField(RACE_CONDITION, condition, "weather"),
            ground_condition: readIntField(RACE_CONDITION, condition, "groundCondition"),
        }));
    }

    function decodeWinSaddles() {
        return arrayPointers(readPtrField(CAREER, singleModePtr, "winSaddleArray"))
            .map((saddle) => readPlainIntField(WIN_SADDLE, saddle, "id"));
    }

    // HomeInfo holds the live training commands. This script does not read it,
    // so it emits the same typed placeholder umadump emits for a null source.
    function emptyHomeInfo() {
        return {
            command_info_array: [],
            race_entry_restriction: 0,
            disable_command_id_array: [],
            available_continue_num: 0,
            available_free_continue_num: 0,
            free_continue_num: 0,
            free_continue_time: 0,
            shortened_race_state: 0,
        };
    }

    function decodeCareer() {
        if (!singleModePtr || singleModePtr.isNull()) return null;
        const chara = (charaPtr && !charaPtr.isNull())
            ? charaPtr
            : readPtrField(CAREER, singleModePtr, "character");
        if (!chara || chara.isNull()) return null;

        return {
            single_mode_load_common: {
                chara_info: decodeCharaInfo(
                    chara,
                    readIntField(CAREER, singleModePtr, "totalTurnNum"),
                    readIntField(CAREER, singleModePtr, "state"),
                    readIntField(CAREER, singleModePtr, "playingState"),
                ),
                race_condition_array: decodeRaceConditions(),
                race_random_program_array: [],
                home_info: emptyHomeInfo(),
                unchecked_event_array: [],
                race_history: decodeRaceHistory(),
                win_saddle_id_array: decodeWinSaddles(),
                effected_factor_array: null,
                race_start_info: null,
                race_scenario: null,
                race_reward_info: null,
                add_trophy_info: null,
                trophy_reward_info: null,
                prev_chara_grade: null,
                race_add_reward_info: [],
                reserved_race_array: [],
                mission_list: [],
                story_event_mission_list: [],
                story_event_chara_bonus_list: [],
                start_dress_info: [],
                resume_factor_select: null,
            },
        };
    }

    // --- Export trigger ----------------------------------------------------
    //
    // The skill-learning screen is a reliable moment to dump: opening it routes
    // through the career getters above, so the pointers are latched by the time
    // BeginView runs. The shop listing this hook sits on is not read; only the
    // screen's arrival is.

    hookMethod("Gallop.SingleModeSkillLearningViewController", "BeginView", -1, {
        onEnter() {
            try {
                const career = decodeCareer();
                if (!career) {
                    send({ type: "career_cold" });
                    return;
                }
                send({ type: "career_export", career });
            } catch(e) {
                send({ type: "error", message: "BeginView: " + e });
            }
        }
    });

    send({ type: "ready", classes: Object.keys(targets) });
})();
"""


# --- Host side -------------------------------------------------------------


# --- Wine / Proton attachment ---------------------------------------------
#
# On Linux the Windows client runs as a PE under Wine or Proton, which is a
# normal Linux process. Attaching the local Frida device to it injects Frida's
# *Linux* agent into a Wine process, which crashes it (frida/frida#3339, seen
# as "bootstrapper crashed with signal 11"). The supported path is to run
# Frida's *Windows* server inside the same prefix and attach through the remote
# device it exposes, so the Windows agent is injected instead.


def _read_proc_environ(pid):
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            raw = f.read()
    except OSError:
        return None
    env = {}
    for entry in raw.split(b"\0"):
        key, sep, value = entry.partition(b"=")
        if not sep:
            continue
        env[key.decode("utf-8", "replace")] = value.decode("utf-8", "replace")
    return env


def _exe_path(pid):
    try:
        return os.readlink(f"/proc/{pid}/exe")
    except OSError:
        return ""


def _strip_container_prefix(path):
    # Proton runs the client inside a pressure-vessel container, so the paths
    # its processes report carry a /run/host prefix that is not on the host.
    if path.startswith("/run/host"):
        return path[len("/run/host"):]
    return path


def _wineserver_contexts():
    """Map every running prefix to the Wine loader that owns it."""
    contexts = {}
    try:
        entries = os.listdir("/proc")
    except OSError:
        return contexts
    for entry in entries:
        if not entry.isdigit():
            continue
        if "wineserver" not in os.path.basename(_exe_path(entry)):
            continue
        env = _read_proc_environ(entry)
        if not env:
            continue
        prefix = _strip_container_prefix(env.get("WINEPREFIX", ""))
        loader = _strip_container_prefix(env.get("WINELOADER", ""))
        if prefix and loader:
            contexts[prefix] = loader
    return contexts


def find_wine_context(pid):
    """Return (prefix, wine_loader) when `pid` is a Wine/Proton process."""
    env = _read_proc_environ(pid)
    if not env:
        return None
    prefix = _strip_container_prefix(env.get("WINEPREFIX", ""))
    loader = _strip_container_prefix(env.get("WINELOADER", ""))
    if prefix and loader:
        return prefix, loader
    # Not every Proton build exports WINELOADER to the client itself, so fall
    # back to the wineserver that owns the prefix.
    contexts = _wineserver_contexts()
    if prefix and prefix in contexts:
        return prefix, contexts[prefix]
    if env.get("STEAM_COMPAT_PROTON") == "1" and contexts:
        return next(iter(contexts.items()))
    return None


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _frida_server_binary():
    """Return a Windows frida-server.exe, downloading it when necessary."""
    if _args.frida_server:
        return os.path.abspath(_args.frida_server)
    version = frida.__version__
    dest = os.path.join(
        FRIDA_SERVER_CACHE, f"frida-server-{version}-windows-x86_64.exe"
    )
    if os.path.exists(dest):
        return dest
    os.makedirs(FRIDA_SERVER_CACHE, exist_ok=True)
    asset = f"frida-server-{version}-windows-x86_64.exe.xz"
    url = f"https://github.com/frida/frida/releases/download/{version}/{asset}"
    log(f"Downloading {asset} ...")
    archive = dest + ".xz"
    try:
        with urllib.request.urlopen(url) as response, open(archive, "wb") as out:
            shutil.copyfileobj(response, out)
        with lzma.open(archive, "rb") as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out)
    finally:
        if os.path.exists(archive):
            os.remove(archive)
    return dest


def start_frida_server(prefix, wine_loader):
    """Run frida-server.exe inside `prefix`; return (process, port)."""
    server = _frida_server_binary()
    port = _free_port()
    env = dict(os.environ)
    env["WINEPREFIX"] = prefix
    env["WINEDEBUG"] = "-all"
    log(f"Starting the Windows frida-server in {prefix} ...")
    proc = subprocess.Popen(
        [wine_loader, server, "--listen", f"127.0.0.1:{port}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    return proc, port


def connect_remote(address):
    """Connect to a frida-server, waiting for it to come up."""
    device = frida.get_device_manager().add_remote_device(address)
    deadline = time.time() + WINE_SERVER_WAIT_SECONDS
    while True:
        try:
            device.enumerate_processes()
            return device
        except Exception:
            if time.time() > deadline:
                raise
            time.sleep(0.5)


def find_process(device):
    """Return the running game's pid on `device`, waiting for it to appear.

    Enumeration goes through the device rather than a module-level helper;
    `frida.enumerate_processes()` does not exist in frida 17.
    """
    deadline = time.time() + MAX_WAIT_SECONDS
    announced = False
    while time.time() < deadline:
        for proc in device.enumerate_processes():
            if proc.name in TARGET_PROCESS_NAMES:
                return proc.pid
            lowered = proc.name.lower()
            if any(k in lowered for k in PROCESS_KEYWORDS):
                return proc.pid
        if not announced:
            log("Waiting for Umamusume to start...")
            announced = True
        time.sleep(2)
    raise SystemExit("Game process not found.")


def resolve_target():
    """Pick a Frida device and pid for the running client.

    Returns (device, pid, server_process_or_None). The Wine/Proton path leaves
    a frida-server child running so the caller can stop it on exit.
    """
    if _args.remote:
        device = connect_remote(_args.remote)
        return device, find_process(device), None

    local = frida.get_local_device()
    local_pid = find_process(local)

    context = None
    if _args.wine_prefix:
        context = (_args.wine_prefix, _args.wine_binary or "wine")
    elif sys.platform.startswith("linux"):
        context = find_wine_context(local_pid)

    if not context:
        if sys.platform.startswith("linux") and _exe_path(local_pid).lower().endswith(".exe"):
            log("This looks like a Wine/Proton process, but its prefix could not be")
            log("detected. Re-run with --wine-prefix /path/to/pfx if the client crashes.")
        return local, local_pid, None

    prefix, wine_loader = context
    log("Wine/Proton client detected. Attaching through a Windows frida-server;")
    log("a plain local attach would inject the Linux agent and crash the game.")
    server, port = start_frida_server(prefix, wine_loader)
    try:
        device = connect_remote(f"127.0.0.1:{port}")
        pid = find_process(device)
    except Exception:
        server.terminate()
        raise
    return device, pid, server


# Fields that decide whether a career is worth writing at all. A payload with
# zeroed stats looks valid to whatever reads it and would silently produce a
# wrong result, which is worse than no file at all.
REQUIRED_CHARA_FIELDS = (
    "single_mode_chara_id",
    "card_id",
    "speed",
    "stamina",
    "power",
    "guts",
    "wiz",
)


def _fill_unread(value):
    """Replace unresolved reads with 0 inside the int-typed regions.

    `chara_info` and its list entries, race history, race conditions and the
    win saddles are all int-typed, so a null there is a field lookup that
    failed, not data. The race-context keys and `effected_factor_array` are
    legitimately null and sit outside these regions, so they are not walked.
    """
    if value is None:
        return 0
    if isinstance(value, dict):
        return {key: _fill_unread(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_fill_unread(item) for item in value]
    return value


def build_export(career):
    """Validate a career payload and fill the reads that failed.

    The Frida side sends null for any field it could not resolve, so a moved
    class or field surfaces here instead of turning into a zero. Core stats are
    required; everything else defaults to 0, which the report then flags.
    """
    common = career["single_mode_load_common"]
    chara = common["chara_info"]

    missing = [key for key in REQUIRED_CHARA_FIELDS if chara.get(key) is None]
    if missing:
        raise SystemExit(
            "Career read is incomplete — missing " + ", ".join(missing) + "."
        )

    unread = [key for key, value in chara.items() if value is None]
    common["chara_info"] = _fill_unread(chara)
    for section in ("race_history", "race_condition_array", "win_saddle_id_array"):
        common[section] = _fill_unread(common[section])

    return career, unread


STRATEGY_NAMES = {1: "Front Runner", 2: "Pace Chaser", 3: "Late Surger", 4: "End Closer"}


def report(career, unread):
    common = career["single_mode_load_common"]
    chara = common["chara_info"]
    style = chara["race_running_style"]

    log("")
    log(f"  Career:         {chara['single_mode_chara_id']}  (card {chara['card_id']})")
    log(f"  Turn:           {chara['turn']}")
    log(f"  Scenario/route: {chara['scenario_id']} / {chara['route_id']}")
    log(f"  Stats:          {chara['speed']} / {chara['stamina']} / "
        f"{chara['power']} / {chara['guts']} / {chara['wiz']}")
    log(f"  SP available:   {chara['skill_point']}")
    log(f"  Running style:  {STRATEGY_NAMES.get(style, style)}")
    log(f"  Learned skills: {len(chara['skill_array'])}"
        f"   (tips: {len(chara['skill_tips_array'])})")
    log(f"  Race history:   {len(common['race_history'])} races")

    if unread:
        log("")
        log(f"  NOTE: {len(unread)} field(s) did not resolve and were written as 0:")
        log(f"        {', '.join(unread)}")
        log("        A field that moved shows up here; check the class scan found")
        log("        its declaring type.")

    if chara["skill_point"] == 0:
        log("")
        log("  NOTE: SP read as 0. If that is wrong, the ObscuredInt layout has")
        log("        moved and `skillPoint` needs re-checking.")

    log("")
    log("  Placeholders in this payload: home_info, race_condition_array,")
    log("  race_random_program_array, unchecked_event_array, effected_factor_array,")
    log("  reserved_race_array, resume_factor_select, the mission/start-dress")
    log("  arrays, evaluation_info_array, training_level_info_array,")
    log("  is_short_race, start_time, and the scenario data set. See README.md.")


def main():
    device, pid, server = resolve_target()
    log(f"Attaching to pid {pid}...")
    session = device.attach(pid)
    script = session.create_script(FRIDA_SCRIPT)

    done = {"written": False}

    def on_message(message, _data):
        if message["type"] == "error":
            logger.debug(message)
            log(f"  script error: {message.get('description', message)}")
            return

        payload = message.get("payload") or {}
        kind = payload.get("type")

        if kind == "ready":
            log(f"Hooks installed. Classes found: {', '.join(payload['classes'])}")
            log("Open the skill-learning screen of a running career.")
        elif kind == "error":
            log(f"  {payload['message']}")
        elif kind == "career_cold":
            # The hooks went in after this screen had already read the career,
            # so there is nothing latched yet. Backing out and re-entering the
            # screen routes through the career getters and fills it in.
            log("  The career object is not latched yet.")
            log("  Leave the skill screen and open it again.")
        elif kind == "career_export":
            logger.debug(json.dumps(payload)[:20000])
            career, unread = build_export(payload["career"])
            with open(OUTPUT_PATH, "w", encoding="utf-8", newline="\n") as f:
                json.dump(career, f, indent=2)
                f.write("\n")
            report(career, unread)
            log("")
            log(f"Wrote {OUTPUT_PATH}")
            done["written"] = True

    script.on("message", on_message)
    script.load()

    try:
        while not done["written"]:
            time.sleep(0.5)
    except KeyboardInterrupt:
        log("\nInterrupted.")
    finally:
        session.detach()
        if server is not None:
            server.terminate()


if __name__ == "__main__":
    main()
