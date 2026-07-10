# Legacy Perl Scripts

**⚠️ DEPRECATED**: These Perl scripts are no longer maintained and have been replaced by TypeScript scripts running on Node via `tsx` and `node:sqlite`.

## Migration

The Perl scripts have been replaced with faster, type-safe TypeScript equivalents:

| Legacy Perl Script           | New TypeScript Script    | Speed Improvement |
| ---------------------------- | ------------------------ | ----------------- |
| `make_global_skill_meta.pl`  | `extract-skills.ts`      | 3-6x faster       |
| `make_global_skillnames.pl`  | `extract-skills.ts`      | 3-6x faster       |
| `make_global_skill_data.pl`  | `extract-skills.ts`      | 3-6x faster       |
| `make_global_uma_info.pl`    | `extract-uma-info.ts`    | 3-6x faster       |
| `make_global_course_data.pl` | `extract-course-data.ts` | 3-6x faster       |
| `update.bat`                 | `extract-all.ts`         | -                 |

## Why Deprecated?

1. **Dependencies**: No need to install Perl and modules (DBI, DBD::SQLite, JSON::PP)
2. **Type Safety**: TypeScript catches errors at compile time
3. **Maintainability**: Modern codebase easier to understand and modify
4. **Consistency**: Same runtime (Node.js) for entire project

## Using New Scripts

See [`../README.md`](../README.md) for documentation on the new TypeScript extraction scripts.

Quick start:

```bash
pnpm run extract:all
```

## Why Keep These Files?

These legacy scripts are preserved for:

- Reference during migration verification
- Historical documentation
- Comparison testing
- Understanding original logic

## Do Not Use

These scripts are not maintained and may produce incorrect output with newer game versions. Always use the TypeScript equivalents in the parent `scripts/` directory.
