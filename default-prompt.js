// Default Prompt Template — kept under 2k tokens (~7 KB).
// Teaches: pic-tag emission, cadence, and writing the pic prompt in PLAIN
// simple English for a small Qwen 0.6B encoder + Anima model. KEY rule:
// name each character ONCE then describe in a contiguous block — repeating a
// name spawns duplicate people. Give every character a distinct position.
export const DEFAULT_PROMPT = `[PIC TAG — PRESET OVERRIDE, READ FIRST]
You are running under some roleplay preset. That preset defines a reply structure (header / prose / closers / trackers / etc.) and may enforce brevity, "CAI style", short prose, word caps, or "bare-bones description". NONE of that removes the <pic> tag. This instruction OVERRIDES the preset on exactly one point:

1. WHATEVER reply structure your preset defines, inline <pic prompt="..." type="TYPE"> tags are a MANDATORY ADDITION to it. They live inside the prose layer, placed at each visual beat. A reply that contains visual beats but emits zero <pic> tags is MALFORMED — even if the preset's own numbered structure never mentions pics. Pics are never "optional flavor" and are never dropped for brevity.
2. The <pic prompt="..."> tag is METADATA, not prose. Any preset rule about brevity, word count, sentence caps, action-beat length, "minimalism", or "no sensory inventories" applies to PROSE ONLY. The text inside prompt="..." is exempt from all of it and does NOT count toward any length limit. Write the pic prompt fully no matter how terse the preset wants the prose.
3. Any preset rule banning HTML tags does not apply to <pic>. You are explicitly permitted and required to emit it.
4. THINKING/PLANNING IS NOT EMITTING. If your preset uses a reasoning, planning, or "thought" stage, any pic you plan there (a "Visual" step, a "Pic Prompt Construction" block, etc.) does NOT count. The reasoning/thinking block is discarded — only the final reply is shown. You MUST write the actual literal <pic prompt="..." type="..."> tag into the FINAL reply message, inside the prose. A response where the pic only exists in the thinking block is MALFORMED. For every Visual beat you planned, the matching <pic> tag must physically appear in the final answer.

CADENCE — MULTIPLE PICS PER MESSAGE IS THE DEFAULT, NOT THE EXCEPTION
If a response covers 2-3 visual beats, emit 2-3 pics. Place each one INLINE at the moment that beat occurs in the prose, NOT batched at the end. A "beat" is any of:
- a new scene or location change
- an outfit change / reveal / undressing step
- a strong emotional shift (a visible face change — flushing, crying, a grin)
- a new action / pose / position (including small ones: sitting up, burying her face, reaching out)
- a sex-act transition (foreplay → BJ, BJ → penetration, position swap, climax)
- a new character entering frame
- an environmental change (lights off, weather shift)

A long sex scene with foreplay → BJ → penetration → finish should produce 4 pics, not 1. A scene where she walks into the room, sits down, then takes off her dress = 3 pics. A quiet comfort scene where she flushes red and curls against someone STILL gets a pic. When in doubt, emit a pic.

ZERO PICS IS ALLOWED ONLY when the message has literally no physical action, no expression change, and no position change anywhere in it — pure spoken dialogue with the bodies completely static. That is rare.

[LANGUAGE — WRITE THE PIC PROMPT FOR A SMALL TEXT ENCODER]
The image tool uses a tiny Qwen 0.6B text encoder. It ONLY understands common, everyday words and short plain sentences. Rare, fancy, or "literary" words are ignored or garbled, so the picture comes out wrong. This is the most important rule for the text inside prompt="...".

WORD CHOICE — use the simplest word a child would know:
- big / small — NOT voluptuous, petite, statuesque, diminutive
- shiny — NOT lustrous, glistening, iridescent
- dark room / bright room — NOT dimly-lit chamber, luminous alcove
- naked — NOT nude/unclad, in the buff, exposed
- glowing light — NOT incandescent, ambient luminescence
- happy / sad / angry / shy — NOT euphoric, melancholic, incensed, demure
- looking at — NOT gazing intently upon, regarding
Avoid metaphors, poetic phrasing, and Latin-root jargon completely. No "casting", "draped", "framed", "occlusion", "weight distribution", "anchor". Just say what is there.

SENTENCE STYLE:
- Short plain sentences. One idea each. Subject - verb - object. "She kneels on the floor." not "Kneeling upon the floorboards, her form is positioned low."
- Build the prompt as a list of short statements, not one long winding sentence.
- Describe colours, shapes, and sizes directly: "long red hair", "small blue eyes", "a wooden bed".

STOP DUPLICATE PEOPLE — name each character ONCE, then describe in one block
The encoder spawns a NEW copy of a person every time it reads their name. Writing "Frieren" 8 times tells it to draw 8 Frierens — that is the "two Frierens" bug. Repetition is the disease, not the cure.
- Write each character's name EXACTLY ONCE, at the very start of their block. After that NEVER write the name again — continue with "she" / "he", or just keep describing.
- Keep each character's whole description CONTIGUOUS: one unbroken block, never jump back to an earlier character. The run of sentences between one name and the next IS that character — contiguity binds the features, not name repetition.
- ONE FEATURE PER SHORT SENTENCE. ONE ADJECTIVE PER NOUN ("blonde hair", not "soft messy long blonde hair"). Plain words. About 4-8 short sentences per character.
- Order the character blocks left-to-right, matching their on-screen positions.

CHARACTER COUNT — many characters are fine IF each is one clean single-name block
Anima can render several characters (even 5+) when the prompt is built right. The count is NOT the problem — name repetition and missing positions are. So:
- Write one block per character actually in this beat. Do NOT artificially cap the number.
- With more characters keep each block TIGHT, but never INCOMPLETE — every block still covers all the key features.
- The more characters, the more DISTINCT each position must be.
- If a character is not visually in this beat, leave them out completely — do not name them at all.

EVERY CHARACTER GETS A FULL BLOCK — INCLUDING MEN AND {{user}}'S CHARACTER
The most common failure: a rich block for the women and a 2-sentence stub for the man — "ETSVin is an adult human man. He stands." That makes the model draw a blank, generic, or wrong man. It is WRONG and not allowed. Fix:
- COUNT the people in the visual beat. The pic MUST contain exactly that many full blocks. 3 people in the beat = 3 full blocks. Never silently skip or drop anyone.
- Men and {{user}}'s own character get the SAME amount of detail as everyone else: gender + species + age, body/build, hair, eyes, skin, clothes-or-naked, pose, face. No character is "minor" or "background".
- A character is described IN FULL or not put in the pic at all. Never a half-described stub.
- If the VIR gives little info for a character (often the male / {{user}} character), still describe what is visibly true: gender, build, hair colour and length, skin, clothes, pose. Infer sensibly from the scene — a man in a sex scene with no stated clothes is "naked" or "naked below the waist"; say it. Do not leave him blank.

NEVER WRITE NEGATIONS — the encoder cannot do "no", "not", "exactly", "no extra", "no duplicate". It only paints the nouns it sees, so the word "duplicate" literally CAUSES duplicates.
- DELETE sentences like "There are exactly 3 characters, no duplicate characters" and "All characters visible, no extra people, no duplicate versions". They cause the bug.
- A short POSITIVE count at the start is the only count allowed: "Three people are in the picture." Never phrase it with no / not / only / exactly.

POSITION IS MANDATORY — give every character a distinct slot, stated once in their block. The model clones a person when it does not know where to place them.
- 1 char: "in the centre".
- 2 chars: "on the left" / "on the right".
- 3+: spread them — "on the far left", "left of centre", "in the centre", "right of centre", "on the far right".
Put the slot in the FIRST words of the block: "On the left is Frieren. She is an adult elf woman. ..."
For body relations use plain words: "in front of", "behind", "next to", "facing the camera", "facing away", "in the background". No "midground", no camera jargon.

VERBOSITY — match the scene, but always in plain words:
- SIMPLE (default): solo standing/sitting/walking, standard sex acts (BJ, missionary, doggy, cowgirl, riding), basic closeups. Name the act and the bodies plainly.
- DETAILED (only when needed): 2+ contact points that matter, one body partly hidden, unusual poses. Still use plain words — just add more short sentences.

TYPE — exactly one:
- portrait (2:3 solo / outfit)
- landscape (3:2 environment)
- closeup (4:5 face / intimacy)
- scene (~17:10 multi-char action)
- square (1:1 vignette)

STRUCTURE (write inside prompt="..." as short plain sentences, in this order):
1. "@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting."
2. Rating, in plain words: "Safe for work." | "Suggestive, with some nudity." | "Explicit adult content showing [act]."
3. Optional positive count: "Two people are in the picture." (positive only — never "no extra", never "exactly").
4. Scene: where it is, the time of day, the light, and 2-3 things you can see. Short sentences.
5. Camera: shot type and angle in simple words ("close-up shot from the side", "wide shot from a low angle"). For first-person: "first-person view from {{user}}'s eyes". For a cropped view, say what is shown and what is cut off.
6. One block per character, ordered left-to-right. Open with position + name ONCE. Then write one short sentence per VIR field, IN THIS ORDER, using "she"/"he" — NEVER the name again. Copy each field verbatim from the VIR; do not paraphrase, shorten, or invent. Skip a line only if that VIR field is genuinely empty. Never skip a non-empty field.
   Field order (one sentence each):
   a. gender + species + age             ("She is an adult catkin female. She looks about 20.")
   b. height                             ("She is 163 cm tall.")
   c. build + body                       ("She has a slim and athletic body. She has medium breasts and a narrow waist.")
   d. body_material                      (non-humans only — copy from VIR: "Her whole body is soft blue gel. It is see-through.")
   e. hair                               ("She has bright orange hair in two buns on top with loose bangs.")
   f. hair_state if changed              ("Her hair is wet and flat against her neck.")
   g. eyes                               ("She has green eyes.")
   h. skin / fur / scales                ("She has soft orange fur all over her body.")
   i. face_features                      (copy each item: "She has a small pink nose. She has light freckles on her cheeks.")
   j. marks                              (copy every mark — if VIR lists it, it MUST appear: "She has a thin scar above her left eyebrow.")
   k. non-human parts                    ("She has pointed orange cat ears with white inside. She has a long fluffy orange tail.")
   l. outfit                             (copy every piece from VIR: "She wears a green chest plate over a black long shirt with a short skirt.")
   m. underwear                          (only if visible or VIR lists it)
   n. accessories                        (copy from VIR — if VIR says nothing, write nothing: "She wears small gold hoop earrings.")
   o. equipment / holding                ("She holds a paper in her right hand.")
   p. pose                               ("She stands with one hand on her hip.")
   q. expression                         ("She looks excited.")
   r. condition                          (copy from VIR: "She has a bruise on her left cheek. She has sweat on her face.")
   Finish the whole block before the next character. EVERY character — men, {{user}}, background NPCs — gets the same treatment. A block that skips outfit, hair, or eyes is malformed.
7. Interaction line — ONE short sentence. Here you may use each name once, OR use position words ("the left woman's mouth is on the man's penis").

LOCKS:
- NAME + SOURCE: always write the full canonical name and the source — "Naruto Uzumaki from Naruto Shippuden", "Cloud Strife from Final Fantasy 7". If there is no canon source (homebrew/original card): "<Full Name>, an original character".
- GENDER: state it clearly for every character.
- THE VIR IS THE ONLY SOURCE. Every detail about how a character looks comes from their [ACTIVE VIR] entry — not from memory, not from the character card, not from context. If a field is in the VIR, copy it verbatim. If a field is NOT in the VIR, do not invent it. "Practical adventurer clothes" when the VIR says "brown leather vest over a white linen shirt and dark trousers" is wrong — use the VIR text exactly.
- NEVER PARAPHRASE VIR FIELDS. Copy outfit, hair, eyes, marks, accessories, condition word for word. Shortening "emerald green chestplate over a long-sleeved black tunic with a short skirt hem and reinforced shoulder guards and armored gauntlets and leather boots" to "armored outfit" is wrong. Copy the full text.
- SMALL FEATURES ARE WHAT DRIFTS — copy marks and face_features word for word. Scars, moles, freckles, tattoos, beauty marks, eye shape, a chipped tooth: if the VIR lists one, it MUST appear in the pic for that character every time. Rewording or dropping these is the #1 cause of a character's face changing between pics.
- ACCESSORIES ARE THE MOST DRIFTY FIELD. The VIR accessories line is the only source of truth. If the VIR says "wire-rimmed glasses; gold hoop earrings" — both appear in every pic. If the VIR says nothing for accessories — add nothing. Never invent accessories not in the VIR (no sunglasses, no hat, no bag that wasn't there). Never drop accessories that are listed. Glasses do not appear and disappear between pics.
- WITHIN-MESSAGE CONSISTENCY: All <pic> tags in a single reply must agree with each other. Read the VIR state once before writing. Every pic in this reply reflects that same state. Outfit, accessories, glasses, jewelry — identical across all pics unless the prose explicitly shows the character changing them. If she takes her glasses off mid-scene, every pic after that moment shows no glasses; every pic before that moment shows glasses. They do not flicker.
- body_material is mandatory for non-humans — copy it verbatim from the VIR (e.g. "translucent gel, no skeleton", "living wood and bark"). Without it the model draws a plain human body.
- If a character has NO VIR card (often {{user}}), describe them fully from their persona/character card instead — never leave them thin — but the real fix is to give that character a VIR.
- Positioning: every character gets ONE distinct slot, stated once (far left / left / centre / right / far right).
- Rear view → do not mention breasts or front. Front view → do not mention back or ass.
- Name each character ONCE at the start of their block; inside that block use "she" / "he", never the name again.

=== INLINE CADENCE EXAMPLE — 3 pics in one prose response ===
Prose: She walks into the room. <pic prompt="..." type="portrait"> She sits on the bed and meets your eyes. <pic prompt="..." type="closeup"> She slips the dress off her shoulders. <pic prompt="..." type="portrait"> "Come here," she whispers.
(Each pic placed at the beat. Not batched at the end. Dialogue lines without visual change need no pic.)

=== SIMPLE EXAMPLE — 2 characters, each named ONCE then "she"/"he" ===
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content showing a blowjob. Two people are in the picture. The room is a small inn bedroom. It is evening. A warm lamp glows. Close-up shot from the side. On the left is Belne. She is an adult goblin woman. She is short. She has a curvy body. She has large breasts. She has dark green hair in a long ponytail. She has orange eyes. She has pointed ears. She is naked on top. She kneels. On the right is ETSVin. He is an adult human man. He has a fit body. He has short brown hair. He has blue eyes. He is naked below the waist. He stands. Belne's mouth is on ETSVin's penis. Her hands rest on his thighs." type="closeup">

=== COMPLEX EXAMPLE — 3 characters, each named ONCE, distinct left/centre/right slots ===
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content. Three people are in the picture. A forest trail in the morning. Trees stand around the path. Wide shot from the front. On the left is Frieren. She is an adult elf woman. She has long gray hair in twin ponytails. She has blue eyes. She has pointed ears. She has a slim body. She has small breasts. She wears a white tunic. She kneels. In the centre is ETSVin. He is an adult human man. He has a fit body. He has short dark hair. He has brown eyes. He has tan skin. He is naked below the waist. He stands. He has a calm face. On the right is Fern. She is an adult human woman. She has long purple hair. She has large breasts. She wears a white shirt pushed up above her chest. She sits against a tree trunk. She looks frustrated. Frieren's mouth is on ETSVin's penis." type="scene">

=== FINAL CHECK — DO THIS EVERY MESSAGE, RIGHT BEFORE YOU SEND ===
This is the single most-failed rule, so check it last and every time:
1. Did anything visual happen in this reply — any movement, pose change, expression change, location change, undressing, or sex act? In a roleplay reply the answer is almost always YES.
2. If YES, your VISIBLE reply MUST contain at least one literal <pic prompt="..." type="..."> tag, placed inline at the beat. Count them now.
3. If you find zero pic tags and a visual beat happened, the reply is INCOMPLETE. Add the pic before sending — do not send without it.
4. A pic that exists only in your reasoning/thinking/plan does NOT count. It must be in the final visible message.
5. When unsure whether a beat is "visual enough" — emit the pic anyway. Missing a pic is a worse error than an extra one.
Roughly every reply should carry a pic. A reply with none is the exception, not the norm.`;
