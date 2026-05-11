# SillyTavern Image Auto Generation

Maintained fork by **knav0**.

Built on top of the original [`st-image-auto-generation`](https://github.com/wickedcode01/st-image-auto-generation) extension by **wickedcode01**.

This extension watches AI messages for `<pic prompt="...">` tags, sends the prompt to SillyTavern's configured image generation command, and attaches the generated image back to the correct chat message.

## Features

- Detects `<pic prompt="..." type="...">` tags in AI replies.
- Supports single or multiple image tags per message.
- Race-safe attachment: images attach to the message that produced the tag, even if another AI message starts while generation is still running.
- Supports SillyTavern `/sd` first, with `/imagine` fallback.
- Insert modes:
  - **Inline Replace Mode**: replaces each `<pic>` tag with a markdown image inside the same AI message.
  - **Insert In Current Message**: attaches images as message media.
  - **Create New Message**: uses SillyTavern's separate generated image message behavior.
  - **Disabled**: turns detection off.
- Resolution presets per image type:
  - `portrait`
  - `landscape`
  - `closeup`
  - `scene`
  - `square`
- Queue concurrency control for ComfyUI and low-VRAM setups.
- Optional streaming pre-generation.
- Optional prompt injection for presets that do not already emit `<pic>` tags.
- Regex test and reset buttons.
- Low VRAM, Balanced, and Quality resolution profile buttons.
- Stores prompt/type/variant metadata for compatibility with inline image viewer workflows.
- Cleaner settings UI with help text for each option.

## Installation

In SillyTavern:

1. Open **Extensions**.
2. Choose **Install extension** or **Install from Git URL**.
3. Paste this URL:

```text
https://github.com/ets1odoo-beep/st-image-auto-generation
```

4. Install for yourself or all users.
5. Restart or reload SillyTavern if needed.

## Requirements

- SillyTavern with Image Generation configured.
- A working `/sd` or `/imagine` slash command.
- ComfyUI, SD WebUI, NovelAI, or another SillyTavern-supported image backend.

Before troubleshooting this extension, confirm that manual image generation works in SillyTavern.

## Tag Format

Recommended:

```html
<pic prompt="masterpiece, highly detailed, cinematic lighting, 1girl in a red cloak" type="portrait">
```

Single quotes also work:

```html
<pic prompt='masterpiece, wide shot of a candlelit tavern' type='scene'>
```

Supported `type` values:

```text
portrait, landscape, closeup, scene, square
```

If the AI omits `type` or writes an invalid type, the extension uses your configured fallback type.

## Recommended Regex

Default regex:

```text
/<pic[^>]*\sprompt=['"]([\s\S]*?)['"]\s*\/?>/g
```

Capture group 1 must be the image prompt.

## Settings

**Image Insert Type**

- Replace mode is best for immersive inline roleplay because the image appears where the `<pic>` tag was.
- Insert mode is useful when you want generated images as media attachments.
- New message mode is the most compatible with SillyTavern's default image behavior.

**Enable Prompt Injection**

Turns on a prompt instruction that tells the AI to write `<pic>` tags. Keep this off if your preset already emits image tags.

**Prompt Template**

The instruction inserted into model context when prompt injection is enabled.

**Regex**

Controls how the extension detects image tags. Use **Test Regex** after editing.

**Position / Depth**

Controls where prompt injection is placed in the model input.

**Default Type**

Fallback image type when a tag has no valid `type`.

**Queue Concurrency**

Use `1` for ComfyUI or low VRAM. Higher values can generate faster but may overload your image backend.

**Generation Delay**

Waits after the AI message finishes before final insertion/replacement.

**Skip Streaming Pre-generation**

When off, generation can begin as soon as a full `<pic>` tag appears during streaming. When on, generation waits until the full AI message is complete.

**Debug Logs**

Enables extra browser console logs for troubleshooting.

## Prompt Injection Example

```xml
<image_generation>
When a visible scene beat should be illustrated, write:
<pic prompt="detailed natural language image prompt" type="portrait|landscape|closeup|scene|square">
Use one tag per important visible action. Put each tag inline after the action it depicts.
</image_generation>
```

## Troubleshooting

**No image appears**

- Confirm `/sd` or `/imagine` works manually.
- Confirm Image Insert Type is not `Disabled`.
- Confirm the AI actually emitted a `<pic prompt="...">` tag.
- Use **Test Regex** to confirm the tag is detected.
- Check the browser console with Debug Logs enabled.

**Images attach to the wrong message**

This fork captures the original message target before generation starts. If this still happens, enable Debug Logs and check whether the original message was deleted, swiped, or edited before generation finished.

**The `<pic>` tag remains after generation**

- In Replace mode, the exact original tag must still exist when generation finishes.
- If the message was edited, swiped, or regenerated while the image was generating, the extension skips replacement safely.

**ComfyUI becomes unstable**

- Set Queue Concurrency to `1`.
- Use Low VRAM resolution profile.
- Add a small Generation Delay if your backend needs time between jobs.

## Attribution

Original extension:

```text
https://github.com/wickedcode01/st-image-auto-generation
```

This maintained fork adds reliability fixes, UI help text, queue controls, type normalization, and safer message-target handling.

## License

AGPL-3.0, inherited from the original project.
