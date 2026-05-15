// Default Prompt Template — pic-tag emission rules + one example.
// Kept tight (~2 KB) so it can sit at the chat tail without competing with
// preset content. Deep rules (camera matrix, anatomy gates, FPP, occlusion,
// dialogue colors, etc.) still belong in the preset; this block ensures the
// AI emits VALID, USABLE pic tags even when those preset blocks aren't loaded.
export const DEFAULT_PROMPT = `Emit \`<pic prompt="..." type="TYPE">\` tags inline in the response whenever a visual beat warrants an image — new scene, outfit reveal, strong emotion, combat, group shot, intimate moment. Place each pic AT the beat it depicts, not batched at the end. No markdown image syntax, no "Image Prompt:" text — only the <pic> tag form.

TYPE — exactly one of:
- portrait (2:3, solo character / outfit reveal)
- landscape (3:2, wide environment / establishing)
- closeup (4:5, face / strong emotion / intimacy)
- scene (~17:10, multi-character action / combat / group)
- square (1:1, vignette / bust)

PROMPT STRUCTURE (single unbroken paragraph inside prompt="..."):
1. Style anchor: "@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting."
2. Rating from current prose: "Safe-for-work content." | "Suggestive content with partial nudity." | "Explicit adult content showing [act]."
3. Scene (1-2 sentences): location + 3-5 details + time-of-day lighting + light direction.
4. Camera: shot type (extreme closeup / closeup / cowboy / medium / wide / extreme wide) + angle (eye-level / low / high / dutch / side). For FPP add "first-person POV from {{user}}'s eyes".
5. Count: "There are exactly N characters in this scene, no extra people, no duplicate characters."
6. Per character paragraph starting "FullName (POSITION):" covering — species + franchise; hair VERBATIM from VIR; eyes (color + shape + gaze); skin/body/anatomy VERBATIM (heights, bust/dick/ass size, marks); non-human traits (tail/wings/horns/ears/fur/scales) VERBATIM; outfit layer-by-layer with exact colors + materials; accessories + equipment; pose + what hands hold; expression.
7. Multi-char only — interaction line with FULL NAMES (never pronouns). For NSFW use plain geometry, never abstract verbs ("her mouth around his erect penis, lips sealed" not "performs oral").
8. Closer: "All N characters are visible in the frame at their stated positions; no extra people or duplicate versions are present."

CRITICAL LOCKS:
- Copy hair / eyes / body / outfit / non-human features VERBATIM from VIR data. Never paraphrase, synonym-swap, or resize.
- Each character paragraph self-contained; no pronouns crossing paragraphs.
- Position labels: Left / Right / Centre / Foreground / Midground / Background.
- Rear view → no breasts/front; Front view → no ass/back; never mix incompatible views.

EXAMPLE:
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Suggestive content with partial nudity. Inside a candlelit inn room at dusk, warm orange glow from a single oil lamp on the dresser, a four-poster bed with rumpled linens, leaded glass window showing fading violet sky, key light from lamp at right warm orange, rim light from window cool blue. Medium full-body shot, eye-level angle from the foot of the bed. There are exactly 1 characters in this scene, no extra people, no duplicate characters. Belne (centre): goblin (original character), apparent adult age, 147 cm petite curvaceous build with large G-cup breasts and ample rounded ass and slim waist with thick thighs, waist-length straight dark green hair tied in a high ponytail with shorter wisps framing her face, large round orange eyes with thick dark lashes looking up at the viewer, light mint-green skin smooth with warm undertone, soft-featured face with small nose and slightly tapered pointed ears, beige short-sleeved cotton tunic loose-fitting hem at mid-thigh secured with a thin brown leather belt at waist with brass buckle, small brass hoop earrings, standing beside the bed with both hands clasped at her waist. Belne looks toward the viewer with parted lips and lifted brows. All 1 characters are visible at their stated positions; no extra people or duplicate versions are present." type="portrait">`;
