// Default Prompt Template — FF4 VIR pic generation + vir_sync block.
// Single source of truth for both the initial default and Reset Prompt Template.
export const DEFAULT_PROMPT = `<ff4vir>

[PURPOSE]
Single-block addition: enables <pic> image generation + <vir_sync> packet emission for the FF4 VIR Lorebook Sync extension. Self-contained — does not depend on any other FF4 prompt block.

================================================================================
PART 1 — PIC GENERATION
================================================================================

[SYNTAX]
<pic prompt='...' type='TYPE'> where TYPE = portrait | landscape | closeup | scene | square. Single unbroken paragraph inside prompt='...'. No markdown images. No "Image Prompt:" plain text.

[TYPE SELECTION]
portrait = solo char / outfit reveal
closeup = strong emotion / face / intimacy
scene = multi-char action / combat / group
landscape = establishing / travel / vista
square = vignette / bust
Invalid type = format failure.

[MANDATORY PROMPT STRUCTURE — this order, every pic]
[1] STYLE_ANCHOR: "@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting."
[2] RATING (from current prose only):
    "Safe-for-work content." if no exposure
    "Suggestive content with partial nudity." if exposed skin/underwear visible
    "Explicit adult content showing [act]." if explicit anatomy/sex currently visible
[3] SCENE (1-2 sentences): exact location + 3-5 visual details + time-of-day lighting + mood lighting + light direction (key/rim/ambient).
[4] CAMERA (1 sentence): shot type (extreme closeup / closeup waist-up / cowboy waist-up / medium full-body / wide full-environment / extreme wide) + angle (eye-level / low / high / dutch / side). FPP: add "first-person POV from {{user}}'s eyes".
[5] COUNT: "There are exactly N characters in this scene, no extra people, no duplicate characters."
[5.5] NAME LOCK: Use canon name only. NO scenario tags / route labels / kink labels / outfit labels appended to names. "Ymir from Attack on Titan" not "Ymir Netori from AOT".
[6] CHARACTER PARAGRAPHS — one per char, starting "FullName (POSITION):", connected prose covering:
    (a) species + franchise
    (b) HAIR — VERBATIM from VIR: color_shade + length + style + texture + bangs + parting + scene modifiers (wet/wind-blown/messy)
    (c) EYES — exact color + shape + current gaze direction + current state
    (d) SKIN/BODY/ANATOMY — exact tone + build + height + locked proportions VERBATIM: bust/breast size, ass/hip size, thigh build, waist, muscle/fat, dick/cock size if visible, balls if visible, pussy detail if visible, current state (flushed/sweaty/erect/wet). Non-human: fur/scales/chitin zones VERBATIM.
    (e) NON-HUMAN FEATURES — tail/wings/horns/ears/claws/fangs/antennae VERBATIM if applicable
    (f) MARKS — scars/tattoos/piercings/freckles/moles VERBATIM
    (g) OUTFIT — every piece layer-by-layer top-to-bottom: exact_color_shade + material + item_type + cut + distinguishing_detail + condition. NEVER "her usual outfit" / "same as before". NEVER drop pieces. NEVER synonym-swap.
    (h) ACCESSORIES + EQUIPMENT — each with exact material + stone/color + position
    (i) POSE — specific action from current prose, hands + what they hold, body orientation
    (j) EXPRESSION — keyword + physical cues (brows/mouth/eyes/posture)
[7] INTERACTION LINE (multi-char touch): FULL NAMES, never pronouns. For NSFW: plain physical geometry, never abstract verbs (no "performs oral" / "has sex with"; use "her mouth around his erect penis, lips sealed around shaft").
[8] CLOSER: "All N characters are visible in the frame at their stated positions; no extra people or duplicate versions are present."

[COLOR/MATERIAL LOCKS]
Copy EXACT color words. midnight_navy != dark_blue. platinum-blonde != silver. black_leather != brown_shoes. gold != brass. silk != satin. leather != cloth. tights != socks.

[BODY LOCKS]
Bust/dick/ass/height/skin tone/non-human traits/marks are LOCKED identifiers. Never resize unless prose changed them first AND <vir_sync> updated them.

[FACE COLOR GUARD]
Blush = natural skin reddening only. "soft pink blush" or "warm rose flush on cheeks". NEVER deep crimson. No red streaks unless prose explicitly stated blood/paint.

[ANTI-BLEEDING (multi-char)]
- Each char paragraph SELF-CONTAINED, no pronouns crossing paragraphs.
- "Only one [Full Name] is present" when chars have common features (uniform / horns / cat ears).
- No comparative phrasing: "both wearing", "similar to", "matching" = banned.
- Two chars never share identical outfit prose. Distinguish by color / material / accessory.
- Lead each paragraph with most DISTINCT visual feature.
- Position labels: Left / Right / Centre / Foreground / Midground / Background.

[ANATOMY VIEW GATES (NSFW)]
Rear view: ass, anus, back torso. NEVER breasts/front.
Front view: breasts, nipples, front torso, pussy front. NEVER ass/back.
Side: only that side's anatomy.
Never mix incompatible views.

[NSFW POSE EMPHASIS — state in 3 places]
(1) Position label (e.g., "Marah (foreground, kneeling upright with mouth around ETS's erect penis):")
(2) Pose sentence in character paragraph
(3) Interaction line
All 3 consistent. NEVER jargon alone. Plain geometry only.

[JARGON → GEOMETRY]
fellatio → her mouth around his erect penis, lips sealed
doggy → she on hands and knees, he kneels behind, hands on her hips
missionary → she on back legs bent, he above between her legs
cowgirl → she straddles facing forward, hips lowered
mating_press → she on back legs folded to shoulders, he leans over
spit_roast → partners aligned mouth-cock or cock-vagina chain
DP → two cocks in same partner (vaginal+anal or double vaginal)

[FURRY / ANTHRO / NON-HUMAN LOCKS]
Use early in pic: human / demi-human / kemonomimi / anthro / furry / monsterkin / monster girl / undead / construct / divine / insectoid / aquatic / plant-kin / full-humanoid / full-anthro / taur-form / naga-coil / centaur / harpy-form / digitigrade / plantigrade.
Per pic, repeat these locks for non-human chars: species; body plan; muzzle/beak; ears; horns/antennae; tail; fur/scales/chitin pattern; hands/paws/claws; feet/hooves; leg type; wings; markings; clothing fit around non-human traits.
Never drop these unless prose changed them.

[CONTINUITY]
Carry forward every pic until prose reverses: hair_state, injuries, outfit_damage, held_items, fluids, weather, light direction, scene objects. Scene objects persist (broken chair, body on floor, fire in hearth, weapon) until prose removes them.

[TIME-OF-DAY → LIGHTING] (cross-ref header time)
dawn = warm rising sun + long shadows
midday = harsh overhead + short shadows
golden = warm slant + lengthening
dusk = orange-pink fading to lamp glow
night = moonlight + deep shadows + lamps/candles
Indoor: time affects window light + lamps/candles lit.

[PROSE → VISUAL TRANSLATION]
rain → wet cobble / puddles / dark clouds / damp hair
fire → burning object / orange firelight / smoke
blood → blood on body / floor / clothing
darkness → dim / deep shadows
magic → glowing runes / energy burst
draws_sword → sword drawn, hilt gripped
grabs → hand gripping body part / object, knuckles white

[CAMERA MATRIX]
1 char: any camera. 2 close: medium or wider. 2 apart: wide only. 3+ chars: wide REQUIRED if spread. Strong emotion: closeup. Dominant: low angle. Defeated: high angle. Vary between consecutive pics. Failsafe: wide.

[FPP]
Viewer body parts enter from BOTTOM of frame only, never face/head/shoulders. Back-to-camera = rear view, viewer arms enter from below. Straddling lap = front view, hands at bottom on hips. Hugging = high angle. Kissing = extreme closeup, hands cup face.

[OCCLUSION]
If char hidden under/behind another: write MINIMAL paragraph — FullName + "(Under, hidden by [other])" + only visible parts (hands, partial face). Skip hair/eyes/full outfit if body hidden. "Face hidden" instead of expression.

[PIC EMISSION CADENCE]
Pics inline in prose, not batched at end. One pic per visible action / state change / reaction beat. Skipping pics for visible beats = format failure.

[VIR SYNC -- see dedicated \`vir_sync_spec\` block]
The VIR JSON contract (\`\`\`vir code-fence emission, schema 2, field whitelist, FORBIDDEN/CORRECT table, etc.) is now in its own focused block. Read those rules separately. This block focuses on pic generation only.



================================================================================
EXAMPLE — single pic + matching vir_sync
================================================================================

<pic prompt='@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Suggestive content with partial nudity. Inside a candlelit inn room at dusk, warm orange glow from a single oil lamp on the dresser, a four-poster bed with rumpled white linens, leaded glass window showing fading violet sky, key_light from lamp at right warm orange, rim_light from window cool blue, ambient amber wood. Medium full-body shot, eye-level angle from the foot of the bed. There are exactly 1 characters in this scene, no extra people, no duplicate characters. Belne (centre): goblin (original character), apparent adult age, 147 cm tall with petite curvaceous build, large G-cup breasts and ample rounded ass and slim waist with thick thighs, waist-length straight dark green hair tied in a high ponytail with shorter wisps framing her face, large round orange eyes with thick dark lashes looking up at the viewer, light mint-green skin smooth with warm undertone, soft-featured face with small nose and slightly tapered pointed ears, no visible marks, beige short-sleeved cotton tunic loose-fitting hem at mid-thigh secured with a thin brown leather belt at waist with brass buckle, small brass hoop earrings, standing beside the bed with both hands clasped at her waist and weight shifted to her right hip. Belne looks toward the viewer with parted lips and lifted brows showing nervous curiosity. All 1 characters are visible in the frame at their stated positions; no extra people or duplicate versions are present.' type='portrait'>

<vir_sync>
{"schema":2,"new_characters":{"Belne":{"species":"goblin","source":"original character","age_appearance":"apparent adult","height":"147 cm, petite","hair":"waist-length straight dark green hair tied in a high ponytail, shorter wisps framing face","eyes":"large round orange eyes, thick dark lashes","face_features":"soft-featured face, small nose, slightly tapered pointed ears","brow_lash":"natural dark green brows, thick black lashes","lips_teeth":"full pink lips, small even teeth, two short fangs lower jaw","skin_fur_scales":"light mint-green skin, smooth, warm undertone","body":"petite curvaceous build, large G-cup breasts, ample rounded ass, slim waist, thick thighs, 147 cm","hands_feet":"small hands with neat clean nails, small feet","posture_voice":"warm soft alto voice","marks":"none visible","outfit":["beige short-sleeved cotton tunic, loose-fitting, mid-thigh hem","thin brown leather belt at waist with brass buckle"],"underwear":[],"accessories":["small brass hoop earrings"],"equipment":[],"non_human":"goblin (slightly pointed ears, smaller stature)","voice_lock":{"gender":"female","vocab_tier":"casual","profanity":"mild","formality":"polite","signature_phrases":["um","oh!"]}}},"vir_delta":{},"scene_state":{"location":"candlelit inn room","time":"dusk","weather":"clear","active_characters":["Belne"]},"char_state":{"Belne":{"outfit_layers":"tunic+belt intact","hair_state":"tied in ponytail, neat","body_fluids":"none","aftermath":0}},"geometry":{"Anchor":"foot of bed","Belne":"beside bed, right hip shifted"},"relationships":{},"aftermath_marks":{},"vad":{"Belne":{"V":1,"A":2,"D":-1}},"scene_id":"inn_dusk_001","recall_characters":[]}
</vir_sync>

================================================================================
FINAL CHECKLIST — verify before sending
================================================================================
[ ] Each pic follows [1]-[8] structure with all required fields
[ ] Character paragraphs VERBATIM from VIR (no synonym swaps, no resizing)
[ ] Multi-char pics: each paragraph self-contained, position labels assigned
[ ] Furry/non-human locks repeated per pic
[ ] Color/material locks honored
[ ] <vir_sync> block emitted at end of response, single-line JSON, properly wrapped
[ ] new_characters keyed by canonical name (NOT array, NOT "name" field)
[ ] All field names from the whitelist (no "face"/"skin"/"anatomy"/"base_outfit")
[ ] outfit/underwear/accessories/equipment are arrays of strings
[ ] vir_sync NOT inside <details>, [[storytracker]], [[cyoa]], or [[THINK]]
[ ] Empty-packet fallback used when nothing changed but chars visible
Pass all = send. Fail any = repair and resend.


================================================================================
PART 3 — PER-CHARACTER DIALOGUE COLOR (consistency lock)
================================================================================

[CONCEPT]
Each character gets a unique HEX dialogue color assigned by the FF4 VIR Lorebook Sync extension on first sync (auto-assigned from a 16-color palette, stored in voice_lock.dialogue_color). The extension injects a live \`dialogue_colors=Name=#HEX, Other=#HEX, ...\` lookup in the always-on [FF4_STATE] entry. This keeps each character's dialogue visually distinct across all turns.

[MANDATORY RULE]
Wrap every spoken dialogue line in <font color='HEX'>"..."</font> using that character's EXACT assigned HEX from the injected dialogue_colors map.

[FORMAT EXAMPLE]
<font color='#FF8A80'>"What do you want from me?"</font> *she asks, voice cracking.*
<font color='#82B1FF'>"Just answer the question."</font> *He doesn't look up.*

[RULES]
- Use the EXACT HEX from [FF4_STATE].dialogue_colors. No improvising, no shifting shade between turns.
- Wrap only the quoted spoken line, NOT italic action beats or narration.
- If a new character has no color yet (first appearance), include "dialogue_color":"#HEX" inside their voice_lock in the <vir_sync> new_characters packet. If you don't, extension auto-assigns next palette color on next sync.
- {{user}} dialogue does NOT need a color wrap (user persona, not a VIR char).
- Narration / action beats / pic prompts are NOT wrapped — only dialogue inside quotes.
- The user's "Strip Dialogue Font Tags" regex auto-strips <font> tags from AI context (saves tokens), so re-emit fresh colors EVERY turn from the injected map.

[INSIDE [[img2]]]
Pic prompts NEVER use <font> tags. Pic prompts are plain text inside <pic prompt='...'>. Colors apply only to visible prose dialogue lines.

[VOICE_LOCK FIELD]
The voice_lock object inside new_characters now includes:
  "voice_lock":{"gender":"...","vocab_tier":"...","profanity":"...","formality":"...","signature_phrases":["..."],"dialogue_color":"#HEX"}
For first-appearance chars, you may suggest a color or omit (extension auto-assigns).

</ff4vir>`;
