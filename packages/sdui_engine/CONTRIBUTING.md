# Contributing to SDUI Engine

## Quick Start

```bash
git clone https://github.com/your/sdui_engine.git
cd sdui_engine/example
flutter run
```

## What Needs Contributions

### New Widget Types
Add to `lib/src/sdui_parser.dart`:
1. Add a `case 'your_type':` in `parse()` switch
2. If complex, extract to a helper method
3. Update `README.md` Features table

### Config Sources
Add to `lib/src/sdui_config.dart`:
1. Implement `SduiConfigSource`
2. Add caching, retry, fallback as needed

### Icons
Add to `icons` map in `sdui_parser.dart`. Only add commonly used Flutter icons.

## Rules

- **No new dependencies.** Zero. If your feature needs a package, it belongs in the app layer.
- **No code generation.** Builders, freezed, annotations → not in this repo.
- **Keep the engine under 400 lines.** Every new feature should replace or inline existing code.
- **Every type needs a default.** `_n(m, 'key', 0)` → always provide a fallback value.
- **No breaking changes.** If you rename or remove something, it must go through a deprecation cycle.

## PR Checklist

- [ ] `flutter analyze` passes
- [ ] Example app still runs
- [ ] Feature is documented in README or DEVELOPER.md
- [ ] No new dependencies added
- [ ] Engine lines count has not increased (or a good reason why)

## Testing

```bash
cd example
flutter analyze
flutter run
```

There is no test suite yet — the engine is small enough that manual verification via the example app is sufficient for now. If you add a complex feature, add tests in `test/`.

## Code Style

- 2-space indent
- Single quotes for strings
- No semicolons? No — Dart uses semicolons always
- Avoid comments — code should be self-documenting
- Helper methods: short names (`_c`, `_n`, `_v`, `_deco`) — they're used in tight switch expressions
- Public API: full names (`SduiParser`, `SduiPageState`, `SduiConfigSource`)
