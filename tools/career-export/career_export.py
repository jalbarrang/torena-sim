# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "frida",
# ]
# ///
"""Export a running career as a skill-planner career document.

Reads a live Umamusume career off the skill-learning screen and writes a
`SkillPlannerExportData` JSON document — trainee, stats, aptitudes, SP balance,
Fast Learner condition, learned skills, and every skill the shop is selling with
its hint level.

That document is a planning tool's own import/export shape, so a capture taken
from the game and a plan shared between players are the same file. There is no
intermediate dialect to convert.

Usage:
    uv run career_export.py [--out career-export.json] [--debug]

Then, in game, open the skill-learning screen of an active career. The hook
fires on `BeginView`, the file is written, and the script exits.

Field offsets come from the `SingleModeSkillLearningViewController.SkillInfo`
layout reverse-engineered by UmaExtractor (github.com/xancia/UmaExtractor).
Career state is read through the `WorkDataManager -> WorkSingleModeData ->
WorkSingleModeCharaData` accessor chain used by honse-tracker.
"""

import argparse
import json
import logging
import os
import sys
import time

import frida

# --- Config ----------------------------------------------------------------

TARGET_PROCESS_NAMES = ["UmamusumePrettyDerby.exe", "UmamusumePrettyDerby"]
PROCESS_KEYWORDS = ["uma", "musume", "derby", "cygames"]
MAX_WAIT_SECONDS = 3600

# `single_mode_chara_effect` id for the SP-discount condition. Only its presence
# matters here; the planner applies the discount itself.
FAST_LEARNER_EFFECT_ID = 7

# Running styles as the planner encodes them.
STRATEGY_BY_APTITUDE_FIELD = {
    "nige": 1,
    "senko": 2,
    "sashi": 3,
    "oikomi": 4,
}

_parser = argparse.ArgumentParser(description="Career exporter")
_parser.add_argument("--out", default="career-export.json", help="Output path")
_parser.add_argument("--debug", action="store_true", help="Write career_export.log")
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
        "il2cpp_method_get_name", "il2cpp_method_get_param_count",
        "il2cpp_field_get_name", "il2cpp_field_get_offset",
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
    // ObscuredInt is a value-type pair: {key, hidden}; the plaintext is the xor.
    function readObscuredIntAt(base, offset) {
        const key = base.add(offset).readS32();
        const hidden = base.add(offset + 4).readS32();
        return hidden ^ key;
    }

    // --- Class scan --------------------------------------------------------

    const TARGET_CLASSES = [
        "Gallop.SingleModeSkillLearningViewController",
        "Gallop.WorkSingleModeData",
        "Gallop.WorkSingleModeCharaData",
        "SkillInfo",
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
                const fiter = Memory.alloc(ptrSize);
                fiter.writePointer(ptr(0));
                for (let i = 0; i < 400; i++) {
                    const field = fn.class_get_fields(classPtr, fiter);
                    if (field.isNull()) break;
                    classInfo.fields[readCStr(fn.field_get_name(field))] = fn.field_get_offset(field);
                }
            }

            targets[targetLookup[fullName] ? fullName : name] = classInfo;
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
    // Rather than walk the WorkDataManager singleton, latch the live
    // WorkSingleModeCharaData off the game's own traffic. This needs no
    // static-field resolution, which differs across IL2CPP builds.
    //
    // A hook only sees calls made after it is installed, so latching one
    // getter is not enough: attaching while the skill screen is already open
    // misses everything that screen read on the way in. Two hooks are used --
    // `get_Character`, which anything touching the career goes through, and
    // `get_Speed` as a second chance -- and BeginView tolerates the pointer
    // still being cold rather than giving up on the run.

    let charaPtr = null;

    let singleModePtr = null;
    let recordedStyle = null;

    hookMethod("Gallop.WorkSingleModeData", "get_Character", 0, {
        onEnter(args) { singleModePtr = args[0]; },
        onLeave(retval) {
            if (retval && !retval.isNull()) charaPtr = ptr(retval.toString());
        }
    });

    // One hook is not enough to catch WorkSingleModeData. Its getters are not
    // called while a screen sits idle, and the skill screen reads the chara
    // from a reference it already holds rather than asking for it again — so
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

    // If the game works the style out for itself, take its answer and skip the
    // call entirely.
    hookMethod("Gallop.WorkSingleModeData", "GetCardRunningStyle", 1, {
        onEnter(args) { singleModePtr = args[0]; },
        onLeave(retval) {
            const value = retval.toInt32();
            if (value >= 1 && value <= 4) recordedStyle = value;
        }
    });

    hookMethod("Gallop.WorkSingleModeCharaData", "get_Speed", 0, {
        onEnter(args) { charaPtr = args[0]; }
    });

    const INT_GETTERS = {
        speed: "get_Speed",
        stamina: "get_Stamina",
        power: "get_Power",
        guts: "get_Guts",
        wiz: "get_Wiz",
        card_id: "get_CardId",
        motivation: "get_Motivation",
        proper_distance_short: "get_ProperDistanceShort",
        proper_distance_mile: "get_ProperDistanceMile",
        proper_distance_middle: "get_ProperDistanceMiddle",
        proper_distance_long: "get_ProperDistanceLong",
        proper_ground_turf: "get_ProperGroundTurf",
        proper_ground_dirt: "get_ProperGroundDirt",
        proper_running_style_nige: "get_ProperRunningStyleNige",
        proper_running_style_senko: "get_ProperRunningStyleSenko",
        proper_running_style_sashi: "get_ProperRunningStyleSashi",
        proper_running_style_oikomi: "get_ProperRunningStyleOikomi",
    };

    const getterCache = {};

    function callIntGetter(methodName) {
        if (!charaPtr || charaPtr.isNull()) return null;
        if (!(methodName in getterCache)) {
            const match = findMethod("Gallop.WorkSingleModeCharaData", methodName, 0);
            getterCache[methodName] = match
                ? new NativeFunction(ptr(match.compiledAddr), "int32", ["pointer"])
                : null;
        }
        const f = getterCache[methodName];
        if (!f) return null;
        try { return f(charaPtr); } catch(e) { return null; }
    }

    // The career records the style the trainee last raced with, so it does not
    // have to be inferred from aptitudes. It hangs off WorkSingleModeData
    // rather than the chara, keyed by card id.
    function readRunningStyle(cardId) {
        if (recordedStyle !== null) return recordedStyle;
        if (!singleModePtr || singleModePtr.isNull() || !cardId) return null;

        const match = findMethod("Gallop.WorkSingleModeData", "GetCardRunningStyle", 1);
        if (!match) return null;

        try {
            const f = new NativeFunction(ptr(match.compiledAddr), "int32", ["pointer", "int32"]);
            return f(singleModePtr, cardId);
        } catch(e) { return null; }
    }

    function readCareer() {
        if (!charaPtr || charaPtr.isNull()) return null;

        const out = {};
        for (const [key, method] of Object.entries(INT_GETTERS)) {
            out[key] = callIntGetter(method);
        }

        out.running_style = readRunningStyle(out.card_id);

        // SkillPoint has no plain getter — the backing field is an ObscuredInt.
        const charaInfo = targets["Gallop.WorkSingleModeCharaData"];
        const spOffset = charaInfo ? charaInfo.fields["<SkillPoint>k__BackingField"] : undefined;
        out.skill_point = null;
        if (spOffset !== undefined && spOffset > 0) {
            try { out.skill_point = readObscuredIntAt(charaPtr, spOffset); } catch(e) {}
        }

        // Active career conditions. The array is ObscuredInt[], so each element
        // is an 8-byte {key, hidden} pair rather than a pointer.
        out.chara_effect_ids = [];
        const effectOffset = charaInfo
            ? charaInfo.fields["<CharaEffectIdArray>k__BackingField"] : undefined;
        if (effectOffset !== undefined && effectOffset > 0) {
            try {
                const arr = charaPtr.add(effectOffset).readPointer();
                const len = readArrayLength(arr);
                if (len > 0 && len < 64) {
                    for (let i = 0; i < len; i++) {
                        out.chara_effect_ids.push(readObscuredIntAt(arr, 0x20 + i * 8));
                    }
                }
            } catch(e) {}
        }

        return out;
    }

    // --- Skill shop --------------------------------------------------------

    hookMethod("Gallop.SingleModeSkillLearningViewController", "BeginView", -1, {
        onEnter(args) {
            const controller = args[0];
            try {
                const skillInfoList = controller.add(64).readPointer();
                const infoCount = readListCount(skillInfoList);
                const infoArr = readListItemsArray(skillInfoList);

                // A garbage List count here loops into the millions and builds a
                // payload past Frida's 128MiB IPC limit, which drops the message
                // and hangs the game. Clamp rather than trust.
                const MAX_GROUPS = 64, MAX_SKILLS = 1024;
                if (infoCount < 0 || infoCount > MAX_GROUPS) {
                    console.log(`[HOOK] BeginView: implausible group count ${infoCount}, skipping`);
                    return;
                }

                const skills = [];
                for (let gi = 0; gi < infoCount; gi++) {
                    const skillInfo = readArrayElement(infoArr, gi);
                    if (!skillInfo || skillInfo.isNull()) continue;
                    const skillList = skillInfo.add(16).readPointer();
                    const skillCount = readListCount(skillList);
                    const skillArr = readListItemsArray(skillList);
                    if (skillCount < 0 || skillCount > MAX_SKILLS) continue;

                    for (let si = 0; si < skillCount; si++) {
                        const info = readArrayElement(skillArr, si);
                        if (!info || info.isNull()) continue;
                        try {
                            skills.push({
                                skillId:      info.add(16).readS32(),
                                currentLevel: info.add(20).readS32(),
                                isAcquired:   info.add(32).readS32(),
                                baseCost:     info.add(52).readS32(),
                                hintLevel:    info.add(60).readS32(),
                            });
                        } catch(e) { /* torn entry; skip it */ }
                    }
                }

                const career = readCareer();
                if (!career) {
                    send({ type: "career_cold", skillCount: skills.length });
                    return;
                }

                send({ type: "career_export", skills, career });
            } catch(e) {
                send({ type: "error", message: "BeginView: " + e });
            }
        }
    });

    send({ type: "ready", classes: Object.keys(targets) });
})();
"""


# --- Host side -------------------------------------------------------------


def find_process():
    """Return the running game's pid, waiting for it to appear.

    Enumeration goes through the local device rather than a module-level
    helper; `frida.enumerate_processes()` does not exist in frida 17.
    """
    device = frida.get_local_device()
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


def build_export(skills, career):
    """Assemble a SkillPlannerExportData document.

    Raises if any field that decides a plan is missing. A file with zeroed
    stats looks valid to the planner and would silently produce a wrong plan,
    which is far worse than refusing to write one.
    """
    missing = [k for k in ("card_id", "speed", "stamina", "power", "guts", "wiz")
               if not career.get(k)]
    if missing:
        raise SystemExit(f"Career read is incomplete — missing {', '.join(missing)}.")

    obtained = [s for s in skills if s["isAcquired"]]
    buyable = [s for s in skills if not s["isAcquired"]]

    style_aptitudes = {
        key: career.get(f"proper_running_style_{key}") or 0
        for key in STRATEGY_BY_APTITUDE_FIELD
    }
    best_style = max(style_aptitudes, key=lambda k: style_aptitudes[k])

    # The career remembers the style the trainee last raced with. Fall back to
    # the best aptitude only when that read gives nothing usable.
    recorded_style = career.get("running_style")
    if recorded_style in STRATEGY_BY_APTITUDE_FIELD.values():
        strategy, strategy_source = recorded_style, "recorded by the career"
    else:
        strategy = STRATEGY_BY_APTITUDE_FIELD[best_style]
        strategy_source = "guessed from the best aptitude"

    effect_ids = career.get("chara_effect_ids") or []

    export = {
        "card_id": career["card_id"],
        "speed": career["speed"],
        "stamina": career["stamina"],
        "power": career["power"],
        "guts": career["guts"],
        "wiz": career["wiz"],
        "proper_distance_short": career.get("proper_distance_short") or 0,
        "proper_distance_mile": career.get("proper_distance_mile") or 0,
        "proper_distance_middle": career.get("proper_distance_middle") or 0,
        "proper_distance_long": career.get("proper_distance_long") or 0,
        "proper_ground_turf": career.get("proper_ground_turf") or 0,
        "proper_ground_dirt": career.get("proper_ground_dirt") or 0,
        "proper_running_style_nige": style_aptitudes["nige"],
        "proper_running_style_senko": style_aptitudes["senko"],
        "proper_running_style_sashi": style_aptitudes["sashi"],
        "proper_running_style_oikomi": style_aptitudes["oikomi"],
        "strategy": strategy,
        "mood": (career.get("motivation") or 3) - 3,
        "budget": career.get("skill_point") or 0,
        "fast_learner": FAST_LEARNER_EFFECT_ID in effect_ids,
        "obtained_skills": [{"skill_id": s["skillId"]} for s in obtained],
        "candidate_skills": [
            {
                "skill_id": s["skillId"],
                "hint_level": s["hintLevel"],
                "game_cost": s["baseCost"],
            }
            for s in buyable
        ],
    }

    return export, effect_ids, strategy_source


STRATEGY_NAMES = {1: "Front Runner", 2: "Pace Chaser", 3: "Late Surger", 4: "End Closer"}


def report(export, effect_ids, strategy_source):
    log("")
    log(f"  Trainee card:   {export['card_id']}")
    log(f"  Stats:          {export['speed']} / {export['stamina']} / "
        f"{export['power']} / {export['guts']} / {export['wiz']}")
    log(f"  SP available:   {export['budget']}")
    log(f"  Fast Learner:   {'yes' if export['fast_learner'] else 'no'}"
        f"   (conditions: {effect_ids or 'none'})")
    log(f"  Running style:  {STRATEGY_NAMES.get(export['strategy'], export['strategy'])}"
        f"   ({strategy_source})")
    log(f"  Learned skills: {len(export['obtained_skills'])}")
    log(f"  Shop skills:    {len(export['candidate_skills'])}")

    if export["budget"] == 0:
        log("")
        log("  NOTE: SP read as 0. If that is wrong, the ObscuredInt layout has")
        log("        moved and `<SkillPoint>k__BackingField` needs re-checking.")


def main():
    pid = find_process()
    log(f"Attaching to pid {pid}...")
    session = frida.attach(pid)
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
            # screen routes through get_Character and fills it in.
            log(f"  Read {payload['skillCount']} shop skills, but the career object")
            log("  is not latched yet. Leave the skill screen and open it again.")
        elif kind == "career_export":
            logger.debug(json.dumps(payload)[:20000])
            export, effect_ids, strategy_source = build_export(
                payload["skills"], payload["career"]
            )
            with open(OUTPUT_PATH, "w", encoding="utf-8", newline="\n") as f:
                json.dump(export, f, indent=2)
                f.write("\n")
            report(export, effect_ids, strategy_source)
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


if __name__ == "__main__":
    main()
