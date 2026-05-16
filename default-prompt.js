// Default Prompt Template — kept under 2k tokens (~7 KB).
// Teaches: pic-tag emission, match verbosity to scene complexity, 2 examples
// (one simple, one moderately complex with light spatial anchoring).
export const DEFAULT_PROMPT = `Emit \`<pic prompt="..." type="TYPE">\` inline whenever a visual beat warrants an image (new scene, outfit reveal, strong emotion, combat, group shot, intimate moment). One pic per beat, placed at the beat, not batched. No markdown image syntax — only the <pic> tag.

VERBOSITY — match the scene:
- SIMPLE (default): solo standing/sitting/walking, standard sex acts (BJ, missionary, doggy, cowgirl, riding), basic closeups. Name the act + the bodies, model handles the geometry.
- DETAILED (only when needed): 2+ char contact points that matter, partial occlusion, unusual poses with weight distribution, amputations/prosthetics, finger-level placement, cropped views.

TYPE — exactly one:
- portrait (2:3 solo / outfit)
- landscape (3:2 environment)
- closeup (4:5 face / intimacy)
- scene (~17:10 multi-char action)
- square (1:1 vignette)

STRUCTURE (one unbroken paragraph inside prompt="..."):

1. "@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting."
2. Rating: "Safe-for-work content." | "Suggestive content with partial nudity." | "Explicit adult content showing [act]."
3. Scene (1-2 sentences): location + 2-4 details + time-of-day lighting + light direction. Name anchor objects (bedpost/table/floor) only if a body part will reference one.
4. Camera: shot type + angle. FPP: "first-person POV from {{user}}'s eyes". Cropped: state what's visible AND cropped.
5. "There are exactly N characters in this scene, no extra people, no duplicate characters."
6. Per character "FullName (POSITION):" covering: species + GENDER (always explicit — "adult female", "young male") + age, body (height/build/bust/dick/ass VERBATIM from VIR), hair (colour/length/style — add parting/bangs only when card specifies), eyes (colour/shape/gaze), skin, marks, non-human traits VERBATIM, outfit pieces with colours/materials + footwear, accessories, POSE (plainly for simple; anchor each non-default body part for complex), expression. State limb status ONLY if non-standard (amputation/prosthetic/paralysis).
7. Multi-char interaction line — names not pronouns. Simple acts: name the act + plain geometry ("Arika kneeling in front of ETSVin, her mouth around his erect penis, both hands on his thighs"). Complex: anchor each contact point.
8. "All N characters are visible at their stated positions; no extra people or duplicate versions are present."

LOCKS:
- NAME + SOURCE: always write full canonical name + the source — "Naruto Uzumaki from Naruto Shippuden", "Monkey D. Luffy from One Piece", "Cloud Strife from Final Fantasy 7". SD models trained on those characters anchor strongly. If no canon source (homebrew/original card): "<Full Name>, an original character" so the model invents from the VIR-described features instead of guessing.
- GENDER explicit per character.
- Copy hair/eyes/body/outfit/non-human VERBATIM from VIR.
- Position labels: Left / Right / Centre / Foreground / Midground / Background.
- Rear view → no breasts/front; Front view → no ass/back.
- Each char paragraph self-contained; no pronouns crossing paragraphs.

=== SIMPLE EXAMPLE — solo sex act, all original characters ===
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content showing a blowjob. Inside a candlelit inn room at dusk, soft amber lamp light, four-poster bed in the background. Closeup waist-up shot, eye-level from the side. There are exactly 2 characters in this scene, no extra people, no duplicate characters. Belne, an original character (left, kneeling): adult female goblin, 147 cm petite curvaceous with large G-cup breasts, waist-length dark green ponytail falling forward, large round orange eyes looking up at his face, light mint-green skin, pointed ears, nude from the waist up with her tunic pooled around her hips. ETSVin, an original character (right, standing): adult male human, athletic build, short brown hair, blue eyes, fair skin, lower half nude with his trousers around his ankles, shirt pulled up to his chest. Interaction: Belne kneeling in front of ETSVin, her mouth around his erect penis with her lips sealed around the shaft, both her hands resting on his thighs. All 2 characters are visible at their stated positions; no extra people or duplicate versions are present." type="closeup">

=== COMPLEX EXAMPLE — known canon character + originals ===
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content showing simultaneous penetration. Inside a stone temple alcove at midnight, single torch on the wall casting warm orange light from frame right, cold blue moonlight from a circular window above, a low black marble altar in the foreground draped with red silk. Wide shot, low angle. There are exactly 3 characters in this scene, no extra people, no duplicate characters. Tifa Lockhart from Final Fantasy 7 (centre, bent over the altar): adult female human, athletic curvaceous with large breasts pressed flat against the cold marble, waist-length dark brown hair tied at the ends, brown eyes half-shut, fair skin flushed pink across shoulders, fully nude, palms flat on the altar taking her weight, hips raised. King Verros, an original character (behind Tifa, standing): adult male human, fat balding middle-aged, ruddy skin, gold silk robe parted open, nude from waist down, both hands gripping Tifa's hips, his erect penis penetrating her anally from behind. Marah, an original character (front of altar, kneeling on a red velvet cushion): adult female elf, slim B-cup, long pale lavender hair in a loose braid over her left shoulder, violet eyes closed, pale skin, pointed ears, fully nude. Interaction: King Verros's hips pressed against Tifa's ass with anal penetration, Tifa's left index and middle fingers pushed past Marah's lips up to the second knuckle, Marah's both hands gripping the front edge of the altar. All 3 characters are visible at their stated positions; no extra people or duplicate versions are present." type="scene">`;
