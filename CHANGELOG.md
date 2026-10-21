# Changelog

## 1.17.1 (2026-10-21)

- Negation stripping is now Anima-only. The Krea2 profile keeps `no / not / without / never / avoid` phrases and limiter words (`only`, `just`) exactly as written, because Krea 2's encoder understands them; Anima's small encoder paints the negated noun, so that profile still strips them. The Krea2 template no longer forbids negations.

## 1.17.0 (2026-10-21)

### Image profiles (Anima / Krea2)

- New **Image Profile** select at the top of the panel: `Krea2` (default) or `Anima`. Manual; it never follows the chat-completion preset and never touches the core Image Generation workflow, style or prefix.
- Each profile keeps its **own prompt template** (`default-prompt.js` now exports `DEFAULT_PROMPT_ANIMA` and `DEFAULT_PROMPT_KREA2`). The textarea edits the active profile's template and **Reset** restores that profile's bundled default. Anima's template opens with the preset's content tag clause (rating word, counts, the stored `PIC_TAG`) and builds person blocks from `PIC_LOOK_SHORT`; Krea2's is one natural-English paragraph built from the full `PIC_LOOK` rows with no tags at all.
- **No artist or style tag is ever injected or prepended.** The `[ARTIST TAG]` section and every `@xlvxp` / quality-word occurrence are gone from both templates; both profiles ship an empty, switched-off quality prefix. Style lives only in the core Image Generation prefix.
- Profile-driven processing: the look lock pastes the short row (Anima) or the full row (Krea2) instead of sniffing the prompt for a rating word; the Krea 2 "no text" closing sentence is added by profile instead of by workflow name; the runaway cap is 1800 chars (Anima) or 6000 (Krea2); each profile remembers its own resolution preset and applies it when selected.
- **Injecting now** readout under the template: the exact injected string counted with SillyTavern's tokenizer, with the profile, depth and role, or the reason nothing is injected (injection off, insert type disabled, chat disabled). A hint under the profile select names the active preset and warns when it, or the FF4 VIR profile, disagrees.
- One-time migration (`profilesV1Applied`): both templates start from their bundled defaults (the saved single template was the bundled Anima-era default with mojibake dashes), the saved `krea_*` resolution preset is remembered by the Krea2 profile, and the loader's bundled-prompt re-sync now checks each profile's template on its own. `promptInjection.prompt` mirrors the active template for older code paths.
- Public API: `window.stImageAutoGenGetProfile()`, `window.stImageAutoGenLockLookSentences(prompt, copies, { lookRow })`.

### Krea 2 pipeline work since 1.16.1 (previously unreleased)

- Krea 2 resolution profiles (1 MP, 1.5 MP, 2 MP, 3 MP) at Krea's own ratios in exact 16-px multiples; the table accepts up to 4096 px per side in steps of 16.
- Prompt cleaner: whole negated phrases are dropped (stopping at punctuation or a conjunction), limiter words (`only`, `just`) are kept, only real generation parameters are stripped, makeup wear words that render as injuries are rewritten, sentence-leading field labels are removed for the Qwen3-VL encoder, and the cap rose from 1800 to 6000 characters cut on a sentence end.
- Look lock: a row head with `from <source>` or a full name replaces the bare name without duplication; clothing, pose, expression and props that share the identity sentence are kept; close-up and rear-view crop filters.
- Krea 2 closing sentence ("Absolutely no text ... pure imagery only") appended after the cleaner.
- One-time Krea2 prefix migration: quality prefix emptied and switched off, portrait/macro framing removed from the core prefix and styles.
- Tag regex upgrades: `<image>` alias, malformed type-first tags, backslash-escaped attributes; default type falls back to portrait; always-on beat-pic cadence (v8) with fallback insertion off.

## 1.16.2

- Remove UTF-8 BOM from manifest.json (breaks JSON.parse on extension import).
