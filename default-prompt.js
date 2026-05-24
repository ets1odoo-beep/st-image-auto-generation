// Default Prompt Template — v1.4 COMPACT (~1500 tokens, was ~5000)
// Sections, in order:
//   1. HARD RULE (top recency anchor)
//   2. WHEN TO EMIT (cadence)
//   3. PIC PROMPT LANGUAGE (Qwen 0.6B encoder rules)
//   4. STRUCTURE (field order + verbatim VIR copy)
//   5. LOCKS (consistency / drift prevention)
//   6. ONE EXAMPLE
//   7. FINAL CHECK (bottom recency anchor — fights mid-chat skip)
export const DEFAULT_PROMPT = `[PIC TAG — MANDATORY, READ FIRST]
Every reply that contains any visual beat MUST include at least one literal \`<pic prompt="..." type="...">\` tag inside the prose. This rule OVERRIDES every preset's brevity / minimalism / "no HTML" instruction. The \`<pic>\` tag is METADATA — prose word-caps do NOT apply to the text inside \`prompt="..."\`.

A pic tag written inside <think>/<thought>/reasoning blocks does NOT count — those are discarded. The literal tag must appear in the FINAL visible reply.

[WHEN TO EMIT — cadence]
A "visual beat" is ANY of: new scene/location, outfit change or undress, expression shift, new pose or position, sex-act transition (foreplay→BJ→penetration→finish), new character entering frame, environmental change.
- A reply with 2-3 visual beats → emit 2-3 pic tags, placed INLINE at each beat, NOT batched at the end.
- A long sex scene (foreplay→BJ→penetration→finish) → 4 pics, not 1.
- ZERO pics ONLY when the reply is pure static dialogue with no physical action, expression change, or position shift — rare. When in doubt, emit one.

[LANGUAGE — Anima + Qwen 0.6B text encoder]
The encoder uses plain everyday words. Rare/literary words get garbled.
- big/small not voluptuous/petite. shiny not lustrous. naked not unclad/nude. happy/sad/angry not euphoric/melancholic.
- Short subject-verb-object sentences, one idea each. "She kneels." not "Kneeling, her form descends."
- Concrete colours/shapes: "long red hair", "small blue eyes", "wooden bed".
- Use simple action verbs: stands, sits, kneels, leans, holds, looks, smiles, walks, turns.
- NEVER write negations. The encoder paints the nouns it sees, so the word "duplicate" in your prompt CAUSES duplicates. Delete sentences like "no extra people", "no duplicate characters", "exactly N people".
- Positive count ONLY at the start: "Three people are in the picture." Never with no/not/only/exactly.

[NAME-ONCE / CONTIGUOUS BLOCK / POSITION]
Repeating a character's name spawns a NEW copy of that person. Writing "Frieren" 8 times tells the encoder to draw 8 Frierens.
- Write each name EXACTLY ONCE, at the start of their block. After that use "she"/"he" only.
- Each character's whole description is ONE contiguous block — never jump back to an earlier character.
- POSITION is mandatory, stated once in their first sentence: "On the left is Frieren.", "In the centre is X.", "On the far right is Y." For body relations use "in front of", "behind", "next to", "facing the camera", "facing away".

[STRUCTURE — write inside prompt="..." in this order]
1. \`@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting.\`
2. Rating: "Safe for work." | "Suggestive, with some nudity." | "Explicit adult content showing [act]."
3. (Optional positive count) "Two people are in the picture."
4. Scene: where + time + light + 2-3 visible things. Short sentences.
5. Camera: shot type + angle in plain words ("close-up shot from the side"). For first-person: "first-person view from {{user}}'s eyes".
6. ONE BLOCK PER CHARACTER, left-to-right. Open with position+name ONCE. Then one short sentence per non-empty VIR field, IN ORDER, COPIED VERBATIM (no paraphrasing):
   a. gender + species + age_appearance     ("She is an adult catkin female. She looks early 20s.")
   b. height                                 ("She is 163 cm tall.")
   c. build + body                           ("She has a slim athletic body. She has medium breasts and a narrow waist.")
   d. body_material (non-humans only)        ("Her body is soft blue gel.")
   e. hair colour + length + texture         ("She has bright orange hair in two buns with loose bangs.")
   f. hair_state if different                ("Her hair is wet and flat against her neck.")
   g. eyes                                   ("She has green eyes.")
   h. skin / fur / scales                    ("She has soft orange fur all over.")
   i. face_features (every item)             ("She has a small pink nose. She has light freckles.")
   j. marks (every item)                     ("She has a thin scar above her left eyebrow.")
   k. non-human parts                        ("She has pointed cat ears. She has a long fluffy tail.")
   l. outfit (every piece from VIR)          ("She wears a green chest plate over a black long shirt with a short skirt.")
   m. underwear (only if visible)
   n. accessories (from VIR — if none, write none)
   o. equipment / holding
   p. pose
   q. expression
   r. condition (sweat, bruises, etc.)
   FINISH the block before the next character. Every character — men, {{user}}, background — gets the SAME treatment.
7. Interaction line — ONE sentence. May use each name once OR position words.

[LOCKS]
- VIR IS THE ONLY SOURCE. Every appearance detail comes from the character's [ACTIVE VIR] entry — not memory, not the character card. If a field is in the VIR, copy it verbatim. If it is NOT in the VIR, do not invent it. "Practical adventurer clothes" instead of the VIR's "brown leather vest; white linen shirt; dark trousers" is WRONG.
- NEVER PARAPHRASE. Copy outfit/hair/marks/accessories word for word, including every piece. Shortening is corruption.
- SMALL FEATURES DRIFT — marks and face_features must appear in EVERY pic. Scars, moles, freckles, tattoos: if the VIR lists one, it appears. Dropping these is the #1 cause of a character's face changing between pics.
- ACCESSORIES ARE THE DRIFTIEST FIELD. VIR's accessories line is the only source. If VIR says "wire-rimmed glasses; gold hoop earrings" — both appear every pic. If VIR says nothing — add nothing. Never invent sunglasses/hat/bag. Glasses do not flicker between pics.
- WITHIN-MESSAGE CONSISTENCY. All <pic> tags in one reply agree with each other. Read the VIR state once before writing. Outfit/accessories/glasses identical across all pics unless the prose explicitly shows a change happening, and then every pic AFTER that point reflects it.
- body_material is MANDATORY for non-humans — slime girl is "translucent gel, no skeleton", dryad is "living wood and bark". Without it the model draws a plain human body.
- If a character has NO VIR card (often {{user}}), describe them fully from persona/character card — never stub them.
- Rear view → no breast/front mention. Front view → no back/ass mention.
- NAME + SOURCE: "Naruto Uzumaki from Naruto Shippuden" or "<Full Name>, an original character".
- GENDER stated clearly for every character.

[TYPE — exactly one]
portrait (2:3 solo) | landscape (3:2 environment) | closeup (4:5 face/intimacy) | scene (~17:10 multi-char) | square (1:1 vignette)

[EXAMPLE — inline cadence, 2 chars named once, distinct positions]
Prose: She walks into the bedroom. <pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content showing a blowjob. Two people are in the picture. A small inn bedroom. It is evening. A warm lamp glows. Close-up shot from the side. On the left is Belne. She is an adult goblin woman. She is short. She has a curvy body. She has large breasts. She has dark green hair in a long ponytail. She has orange eyes. She has pointed ears. She is naked on top. She kneels. On the right is ETSVin. He is an adult human man. He has a fit body. He has short brown hair. He has blue eyes. He is naked below the waist. He stands. Belne's mouth is on ETSVin's penis. Her hands rest on his thighs." type="closeup"> She kneels at his feet.

[FINAL CHECK — RUN THIS BEFORE SENDING — fights mid-chat skip]
1. Did anything visual happen in this reply? (movement / pose / expression / location / undress / sex act) — in roleplay this is almost ALWAYS yes.
2. If yes, does the FINAL visible reply contain at least one literal \`<pic prompt="..." type="...">\` tag, placed inline at the beat? COUNT them.
3. If you find ZERO pic tags and a visual beat happened, the reply is MALFORMED — add the tag before sending.
4. A pic tag in <think>/reasoning/plan does NOT count. It MUST be in the final visible message text.
5. Within the pic prompt: did you name each character ONCE only? Did each get a position slot? Did you copy the VIR fields VERBATIM?
A reply with visual beats and no \`<pic>\` tag fails the contract. End with the pics in place.`;
