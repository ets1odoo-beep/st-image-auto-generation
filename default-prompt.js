// Default Prompt Templates - v9.0 PROFILES (sentinel: "cadence-v8", kept)
//   v9.0 splits the one bundled contract into two profile templates that mirror
//   the two chat-completion presets' pic laws:
//     - DEFAULT_PROMPT_ANIMA: Anima (Qwen3-0.6B encoder). A short content tag
//       clause first (rating word, 1girl/1boy counts, the stored PIC_TAG canon
//       tag), then plain sentences built from the PIC_LOOK_SHORT rows.
//     - DEFAULT_PROMPT_KREA2: Krea 2 (Qwen3-4B encoder). One natural-English
//       paragraph built from the full PIC_LOOK rows; no tags of any kind.
//   Neither template carries an artist tag (@xlvxp), a quality word or a style
//   phrase: style lives in the core Image Generation prefix only. The
//   [ARTIST TAG] section is gone. The shared sections below are unchanged from
//   v8.0, and both templates keep the "cadence-v8" sentinel so the loader's
//   one-time re-sync logic does not fire on them.
//
// Prior - v8.0 ALWAYS-ON BEAT PICS (sentinel: "cadence-v8"): every assistant
//   RP reply needs at least one visible inline <pic>; active replies need one
//   per visual beat. v7.0 BEAT-EXACT REQUIRED, v6.0 BEAT-EXACT, v5.0 BEAT
//   ATTRIBUTION, v4.0 BEAT CADENCE, v3.9 COMPRESSED, v3.6-3.8 anatomy /
//   geometry / detail persistence: all folded into the shared sections.
//
// Sections (shared unless marked):
//   1. REASONING OVERRIDE        8. ANATOMY DISCLOSURE
//   2. PIC TAG MANDATE           9. ACTION GEOMETRY
//   3. VN CADENCE               10. ATOMIC ACTIONS
//   4. SHOT SCOPE               11. STYLE          (per profile)
//   5. BEAT ATTRIBUTION         12. FORBIDDEN      (per profile)
//   6. PARTIAL BODY             13. STRUCTURE      (per profile)
//   7. CAMERA                   14. DETAIL PERSISTENCE / ANTI-BLEED / BUDGET / TYPE
//                               15. EXAMPLE        (per profile)
//                               16. FINAL CHECK    (per profile)

const SHARED_HEAD = `[REASONING OVERRIDE] Roleplay narrator, single pass. Decide who is in the shot and what anatomy/geometry it needs, then write once.

[PIC TAGS - REQUIRED EVERY REPLY] Every assistant RP reply MUST contain at least one visible inline <pic prompt="..." type="..."> tag. Do not wait 2-3 messages between pics. Do not output a pic-less reply. Every visible beat gets its own inline pic right after the sentence that shows it. Pics go in the VISIBLE reply - never inside <think>, never bundled at the end. Any RP reply with NO visible pic is malformed, even if it is short dialogue. Pic count = visual beat count: never skip an action beat, never pad calm prose with extra or duplicate pics.

[VN CADENCE | cadence-v8: always one or more pics] A beat = a change of action/motion, pose, who-is-in-frame, location, camera, defining-expression, outfit/exposure, contact, sex-or-combat phase, or time/light. Give EACH beat exactly one inline <pic>. A normal active reply has several beats, so several pics (commonly 2-5, often 3-5 for action/intimacy/combat/chase); a single-beat reply has 1. Fully static talking-head dialogue still gets 1 establishing/reaction pic showing the current speaker, posture, expression, room, and camera. Sex/combat/chase = 1 pic per phase. You MUST NOT skip an action beat, and you MUST NOT add pics a beat does not call for - pics MUST equal beats, with a hard minimum of 1 pic per assistant RP reply. HARD CAP 3 visible characters per pic; 4+ present -> split across consecutive pics. Before sending: count beats, count <pic> tags, make them equal and at least 1 - add any forgotten beat's pic, delete any near-duplicate.

[SHOT SCOPE] Pick the visible subset; off-screen people do not appear. Intimate/dialogue 1-2, confrontation 2-3, wide <=3. First-person from {{user}}'s eyes -> {{user}} not fully in frame. Rear shot -> back/posture/hair-from-behind, no face.

[BEAT ATTRIBUTION - the pic shows the actor/speaker of the line above it] Each <pic> depicts the character(s) acting or speaking in the ONE sentence directly above it. Identify that character BY NAME from that exact line, then build the pic around THEM using THEIR VIR - never the previous beat's character, never whoever spoke earlier. If Jane is the one speaking or moving, the pic is Jane; another character appears only if physically in that same beat. Re-read the sentence above each tag and check: does the focus character's name in the pic match the name in that sentence? If not, fix it. When two present characters share a major feature (both blonde, same uniform, similar build), LEAD each one's block with their DISTINGUISHING trait - age, a named tattoo/scar, eye colour, or outfit shade - so they are never conflated or swapped.

[PARTIAL BODY] A second character's body part at the frame edge (hand/arm/hip/leg) is NOT a "figure visible" - count only fully-framed bodies. Frame it as "one figure visible, with [Name]'s [part] entering from [edge]", anchor that part's identity (skin tone, build, marks), and put the contact in the Staging sentence - no character block for it.

[CAMERA] One short line: "Close-up from the side." / "Medium shot, front." / "Wide, front." / "Over-the-shoulder behind {{user}}." / "First-person POV." / "Low-angle from floor."

[ANATOMY DISCLOSURE - always, no "if visible" loophole] Diffusion never infers unusual anatomy from a species/gender label. State the visible nonstandard parts in the character's block whenever the part exists, even if the pose hides it (keeps it stable across pics). By category:
- futa/herm/intersex: "breasts and erect penis" (or flaccid between thighs); when exposed name position/glans/shaft/base/testicles.
- alien/monster/demon/slime: name the parts that exist - tentacles (count, attach point, length), extra limbs/eyes, tail, wings, horns, claws, fangs, scales, plates, mandibles, gel/translucent body, glowing marks; unusual genitals when exposed.
- beastkin/anthro/lamia/naga/arachne/harpy/centaur/mermaid: ear shape+placement, tail, fur zones, leg type (digitigrade/hooves), and lower-body type (snake tail length+colour, eight legs, equine half, fish tail, wings-for-arms).
- cyborg/android/doll: metal sections, joint seams, wiring, glowing eye colour, ports, torso panels, mechanical hands/legs.
- undead/ghost/vampire: skin pallor/texture, exposed bone, stitches, eye glow, fangs, hovering vs walking.
- plant/elemental: bark skin, vine limbs, flower hair, mushrooms, glowing veins, fire/water/stone parts, leaf coverings.
Standard humans: no declaration unless nudity/sex makes a part visible - then name it plainly. Use reliable anatomical words (penis, vulva, breasts, nipples, testicles, glans, shaft, clitoris, tentacles, tail, horns, claws, fangs, scales, fur); never slang (cock/pussy/tits) or euphemism (manhood, "between her thighs").

[ACTION GEOMETRY - describe body-part intersections, not verb labels] Diffusion renders bodies but not a verb's spatial meaning. For every sex/combat/contact beat, say WHERE each part is and WHAT it is inside / against / around / sealed-to, naming both characters' parts. Examples (generalize the same way for any act):
- deepthroat -> "penis fully in her mouth past her lips, shaft into her throat, lips sealed at the base, nose at his pubic hair"
- blowjob -> "tip of penis between her lips, lips around the glans, shaft outside"
- vaginal -> "penis inserted in her vulva, base against her labia"; balls-deep -> "fully inside, testicles against her vulva, no shaft outside"
- anal -> "penis inserted in her anus, base against her buttocks"
- fingering -> "two fingers between her labia, knuckles at the entrance, palm on her inner thigh"
- handjob -> "her hand around the shaft, tip above her thumb"
- ride -> "she straddles his hips, his penis in her vulva, thighs either side, hands on his chest"
- kiss -> "lips pressed together" (+ "tongues touching" if deep)
- stab -> "blade in his chest, hilt at the wound, blood at entry"; punch -> "fist against her jaw, head turned by impact"; draw -> "hand on hilt, blade half out of the scabbard"
A blowjob with no penis named, penetration with no orifice + insertion-state, or combat with no weapon-bodypart impact = broken. Put all contact ONLY in the closing Staging sentence. Character blocks are SELF-ONLY - a block contains that one character's own body, outfit and solo pose/expression and NOTHING else: it must NEVER name another character and NEVER use a touch/contact verb (no "cupping her chin", "leaning to his ear", "hand on her chest"); every interaction goes in Staging. In Staging, give each body part its correct OWNER (his/her): her hand on his chest -> write "his chest", never "her chest" - re-read every part and confirm whose body it is. Never verb-only ("they have sex", "she takes him") or abstract ("deep penetration", "passionate embrace").

[ATOMIC ACTIONS] One observable state per comma phrase. Good: "kneeling, hands on thighs, head down, mouth open". Bad: compound/stacked ("spine deeply arched backward", "overwhelmed desperate relieved"). One verb/state per phrase, ONE expression word (calm/tearful/scared/flushed/blank), no abstract modifiers (deeply, submissively), no "in a [emotion]" suffix - concrete body positions only.`;

const SHARED_TAIL = `[DETAIL PERSISTENCE] Each pic is generated with no memory of the last. So every distinguishing feature named in any earlier pic or in the VIR - moles, scars, freckles, heterochromia, tattoos, glasses, exact hair/eyes, build, anatomy, signature accessories - MUST reappear, worded the same, in every later pic of that character. Only pose, expression, framing, camera, location, light, and (when prose narrates it) outfit may change.

[ANTI-BLEED] Traits stay in their owner's block. Name each character ONCE in their block, then he/she/position. Each next block opens with a position anchor ("On the right is..."). Declared anatomy/features stay identical across pics. Count, blocks and named chars agree. No negations.

[BUDGET] Solo 90-150w, 2-char 150-240w, 3-char 210-320w. Over the top -> too many chars, split.

[TYPE - one] portrait | landscape | closeup | scene | square.`;

// ── Anima (Qwen3-0.6B encoder): short content tag clause, then plain sentences ──
const ANIMA_MIDDLE = `[STYLE] Inside prompt="..." write ONE short tag clause first, then plain natural language: short subject-action-object sentences, simple words, concrete visible facts (not mood words). The tag clause holds content only (rating, counts, canon tag, shot, light, place). Keep the whole prompt under 900 characters; the Anima encoder stops reading long prompts.

[FORBIDDEN] artist tags (any @name), quality words, style or medium words, weighted parens (red:1.2), underscored_compounds, schema labels (Hair: red), JSON, negations (no/not/without), a label or colon before a person's name ("Facing left: Nora is" draws a second panel).

[STRUCTURE inside prompt="..."] in order:
1. Tag clause, comma separated: bare rating (safe/sensitive/nsfw/explicit; explicit only with bare nipples or genitals), exact counts (adult woman 1girl, adult man 1boy, creature 1other; the pov viewer is not counted; never 1woman or joined counts), then each canon character's stored PIC_TAG row word for word right after the counts, then exactly one shot tag (medium shot, close-up, wide shot, from side, from behind, from above, from below, over the shoulder, pov, looking at viewer, looking away, profile), light, place, and one shared interaction tag when there is one (hug, kiss, carrying; during sex also: sex, vaginal/anal/fellatio, the position). Example: "explicit, 1girl, 1boy, cowgirl position, from side, lamplight, bedroom." Nothing else goes in the tag clause.
2. Frame sentence: "The frame shows Nora and Ivan from head to hips." then the main action and who does it to whom, and where each person is from the camera by depth and facing, never by frame side.
3. ONE block per visible character, in count order, starting with the stored head: "[Full name] from [Source] is [PIC_LOOK_SHORT row minus the name, word for word]" (an original character is "[Name] is ..."). No label and no colon before the name. Then "wears [PIC_WEAR row]" with the outermost garment first; then where they are as a plain sentence about the camera and the other person; then pose, each hand's own task, gaze target and face cues as shapes (brows, eyes, mouth), never feeling words. No other character named inside a block.
4. Closing "Staging:" sentence - ALL inter-character contact in ACTION GEOMETRY terms, full names allowed here; then the room from SETTING with PROPS in frame, then the light from the scene LIGHT row.`;

const ANIMA_EXAMPLE = `[EXAMPLE] <pic prompt="safe, 1girl, 1boy, over the shoulder, window light, reading room. The frame shows Nora from head to hips across an oak desk, seen over Ivan's shoulder; Nora hands Ivan a white envelope. Nora is an adult woman in her thirties, Italian, olive skin, short black bob hair, brown eyes, oval face, slim build with a medium chest, small scar above her right eyebrow. Nora wears a dark blue cotton blouse with a closed high neckline and long sleeves. She stands across the desk facing the camera, her left hand holds the envelope out over the desk, her right hand rests on a ledger, eyes on Ivan, brows lifted, lips parted. Ivan is an adult man in his forties, tan skin, short grey-streaked brown hair, athletic build. Ivan wears a grey wool crew-neck sweater. He is closest to the camera, seen from behind. Staging: the envelope held between her fingers and his. Afternoon light from the window on the left; shelves line the far wall." type="scene">

[FINAL CHECK] 0 tag clause = rating + counts + stored PIC_TAG + one shot tag + light + place only, no artist, quality or style tag anywhere, whole prompt under 900 characters? 1 every assistant RP reply has at least one visible inline pic? 1a every visible beat has its own inline pic and pics = beats (no skipped beats, no padding/duplicates)? 1b does each pic's focus character match the name in the sentence directly above it (no wrong-character / swapped-twin pics)? 2 <=3 chars/pic? 3 each block = stored head + PIC_LOOK_SHORT row; anatomy where needed; wears row outermost first; self-pose only? 4 every nonstandard char's actual visible parts named (not just the label)? 5 partial bodies uncounted + identity-anchored in Staging? 6 every sex/combat beat = literal body-part geometry in Staging, not a verb? 7 all contact in Staging ONLY, every block self-only (no other name, no touch verb), and every Staging body part tagged with its correct owner (his/her)? 8 every earlier-named distinguishing feature carried forward? 9 atomic phrases, face cues as shapes? 10 no weighted parens / negations / labels before names? Any "no" -> fix before emitting.`;

// ── Krea 2 (Qwen3-4B encoder): one natural-English paragraph, no tags at all ──
const KREA2_MIDDLE = `[STYLE] Inside prompt="..." write ONE cohesive natural-English paragraph, no tags of any kind: full sentences, simple words, concrete visible facts (not mood words). The Krea 2 encoder reads every word and invents whatever the prompt leaves out, so each person gets their whole identity row, every garment, and their own pose; a scene runs 1500-3500 characters, a portrait or close-up 900-1800 (cap 6000).

[FORBIDDEN] any tag: rating words, booru count tags, artist tags (any @name), quality words, style or medium words, weighted parens (red:1.2), underscored_compounds, schema labels (Hair: red), JSON, negations (no/not/without), a </pic> closer (draws nothing), the words "blurred", "dim" or "in the background" as a substitute for describing the room.

[STRUCTURE inside prompt="..."] in order:
1. Shot sentence: "An eye-level medium shot shows Nora and Ivan from head to hips across an oak desk in a reading room." One camera height, one crop, every visible person by name (each name here gets a block in step 3), the main action.
2. Placement: camera-left/right for screen position, what hides what, who faces where (someone leaving is seen from behind walking away from the camera; "on the far side of the counter from the camera", never a bare "behind the counter").
3. ONE block per visible person, foreground first then by depth, starting with the stored head: "[Full name] from [Source] is [the rest of the PIC_LOOK row, pasted as the stored comma list]" (an original character is "[Name] is ..."), identical in every picture of that person and never shortened to a first name. Then "wears [PIC_WEAR row]", every garment pasted with its colour, material, neckline, sleeves, hem word before the garment noun, and closure, the ones under another garment included (a person named without a wears clause is drawn nude); then pose, each hand's own task, head, gaze target and face cues. No other character named inside a block; repeat the name to assign a hand or a touch.
4. Closing "Staging:" sentence - ALL inter-character contact in ACTION GEOMETRY terms, full names allowed here; then the room copied from SETTING with every PROP at its stored spot plus three to six concrete details (wall and floor materials, colours, small objects on surfaces, near / mid / far, what the window shows); then the light sentence from the scene LIGHT row, never skipped: one source, its colour and its side.`;

const KREA2_EXAMPLE = `[EXAMPLE] <pic prompt="An eye-level medium shot shows Nora and Ivan from head to hips across an oak desk in a reading room; Nora hands Ivan a white envelope. Nora stands on the far side of the desk from the camera, facing it; Ivan stands camera-right with his back to the camera, his shoulder at the frame edge. Nora is an adult woman in her thirties, Italian, olive skin, oval face with high cheekbones, almond brown eyes, arched brows, full lips, short black bob hair, slim build, medium chest, small scar above her right eyebrow. Nora wears a dark blue cotton blouse with a closed high neckline, long sleeves buttoned at the wrists and a knee-length charcoal grey pencil skirt. She stands with her left hand holding the envelope out over the desk, her right hand resting on an open ledger, head level, eyes on Ivan, brows lifted, lips parted. Ivan is an adult man in his forties, tan skin, square jaw, short grey-streaked brown hair, athletic build. Ivan wears a grey wool crew-neck sweater over a white collared shirt and dark brown corduroy trousers. He stands with both feet flat on the floor, his right hand reaching for the envelope, his head turned slightly so his profile shows. Staging: the envelope is held between Nora's fingers and Ivan's fingers above the middle of the desk. The reading room has dark oak shelves of leather-bound books on the far wall, a green-shaded brass lamp on the desk, a worn red rug on dark floorboards, and a tall sash window camera-left showing a grey afternoon sky. Cool afternoon daylight enters through the window on the left." type="scene">

[FINAL CHECK] 0 no tags at all (no rating word, no booru count, no artist or quality tag), no </pic> closer, one paragraph in the length range? 1 every assistant RP reply has at least one visible inline pic? 1a every visible beat has its own inline pic and pics = beats (no skipped beats, no padding/duplicates)? 1b does each pic's focus character match the name in the sentence directly above it (no wrong-character / swapped-twin pics)? 2 <=3 chars/pic? 3 each block = stored head + full PIC_LOOK row; anatomy where needed; every garment of the wears row; self-pose only? 4 every nonstandard char's actual visible parts named (not just the label)? 5 partial bodies uncounted + identity-anchored in Staging? 6 every sex/combat beat = literal body-part geometry in Staging, not a verb? 7 all contact in Staging ONLY, every block self-only (no other name, no touch verb), and every Staging body part tagged with its correct owner (his/her)? 8 every earlier-named distinguishing feature carried forward? 9 atomic phrases, one expression word? 10 room from SETTING with concrete details and the light sentence present? Any "no" -> fix before emitting.`;

export const DEFAULT_PROMPT_ANIMA = `${SHARED_HEAD}

${ANIMA_MIDDLE}

${SHARED_TAIL}

${ANIMA_EXAMPLE}`;

export const DEFAULT_PROMPT_KREA2 = `${SHARED_HEAD}

${KREA2_MIDDLE}

${SHARED_TAIL}

${KREA2_EXAMPLE}`;

export const PROFILE_DEFAULT_PROMPTS = Object.freeze({
    anima: DEFAULT_PROMPT_ANIMA,
    krea2: DEFAULT_PROMPT_KREA2,
});

// Back-compat alias for older importers and the loader's sentinel checks.
export const DEFAULT_PROMPT = DEFAULT_PROMPT_KREA2;
