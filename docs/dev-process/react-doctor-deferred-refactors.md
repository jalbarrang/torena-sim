# React Doctor — deferred refactors

Full scan: `pnpm run ql:react -- . --verbose`. Recharts chart modules are lazy-loaded at route/tab boundaries; see `src/components/bassin-chart/lazy-bassin-charts.ts` and `distribution-tab.tsx`.

Address the warnings below only when editing the related feature — avoid drive-by refactors.

## `src/routes/runners/home.tsx` — `RosterHomePage`

**Rules:** `no-giant-component` (~468 lines), `prefer-useReducer` (12 `useState`).

| Extract (suggested)      | State / UI owned                                              |
| ------------------------ | ------------------------------------------------------------- |
| `RosterFiltersBar`       | `search`, `strategyFilter`, `distanceFilter`, `surfaceFilter` |
| `RosterSelectionToolbar` | `selected`, `isSelecting`, bulk delete flow                   |
| `RosterDeleteDialog`     | `deleteDialogOpen`, `runnerToDelete`                          |
| `RosterLoadDialog`       | `loadDialogOpen`, `runnerToLoad`                              |
| `RosterImportDialogs`    | `umadumpImportOpen`, `ocrImportOpen`                          |

Prefer colocating dialog state in extracted components over a page-level `useReducer` unless transitions stay tangled after extraction.

## `src/modules/runners/components/runner-card/runner-card.tsx` — `RunnerCard`

**Rule:** `no-giant-component` (~425 lines).

| Extract (suggested)                      | Notes                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `RunnerCardHeader`                       | Uma selector, action menu, share/import triggers                                          |
| `RunnerCardSkillsSection`                | Skill list; screenshot dialog (`importDialogOpen`) can move with this block               |
| Existing `StatsTable` / `AptitudesTable` | Already split — keep as boundaries                                                        |

## `src/components/presets-panel.tsx` — `PresetsPanel`

**Rules:** `no-giant-component` (~365 lines), `prefer-useReducer` (9 `useState`).

Mirrors roster home: filters (`filterSurface`, `filterDistance`, `filterRaceType`), selection (`selectionMode`, `checkedIds`), dialogs (`deleteDialogOpen`, `presetToDelete`, `bulkDeleteDialogOpen`, `resetDialogOpen`).

| Extract (suggested)                                                 | State owned                                  |
| ------------------------------------------------------------------- | -------------------------------------------- |
| `PresetFilters`                                                     | Filter trio                                  |
| `PresetList` / sortable list                                        | List + DnD; selection when in selection mode |
| `PresetDeleteDialog`, `PresetBulkDeleteDialog`, `PresetResetDialog` | Per-dialog open + payload                    |

## `src/components/save-preset-modal.tsx` — `SavePresetModal`

**Rule:** `prefer-useReducer` (6 `useState`) only.

Lower priority than `PresetsPanel`. Form/modal state can stay local; extract only if the modal grows further.
