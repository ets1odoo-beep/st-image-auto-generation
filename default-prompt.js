// Default Prompt Template — pic-tag emission rules + simple + complex examples.
// Written for modern high-adherence SD models (Anima Base 1.0+, Pony XL,
// Illustrious, etc.) that CAN parse fine spatial relationships when given them,
// but don't NEED that level of detail for simple scenes. Match the verbosity
// to the scene — a single character sitting on a bed is not the same job as
// three characters interacting with occlusion and disabilities.
export const DEFAULT_PROMPT = `Emit \`<pic prompt="..." type="TYPE">\` tags inline in the response whenever a visual beat warrants an image — new scene, outfit reveal, strong emotion, combat, group shot, intimate moment. Place each pic AT the beat it depicts, not batched at the end. No markdown image syntax, no "Image Prompt:" text — only the <pic> tag form.

CORE PRINCIPLE — MATCH VERBOSITY TO COMPLEXITY
Modern SD models CAN parse "left hand resting on the bedpost", "index finger inside her mouth", "lower half hidden behind the dresser", but you only need that level of detail when the scene actually requires it. Use the simple style by default; reach for the detailed style only when the scene has something the model would otherwise get wrong.

USE SIMPLE STYLE for:
- single character standing / sitting / walking / lying down
- standard sex acts in standard positions (blowjob, missionary, doggy, cowgirl, riding) — name the act, name the bodies, model handles the geometry
- basic emotional closeups (one character, one expression)
- one-character outfit reveals

USE DETAILED SPATIAL ANCHORING for:
- 2+ characters where contact points matter (who's hand on whose hip, whose leg between whose)
- partial occlusion (character behind/under furniture, body cropped at frame edge)
- unusual poses with weight distribution (kneeling with one leg folded, hanging upside-down, mid-action mid-air)
- amputations / prosthetics / mobility aids — must be explicit
- finger-level placement when it matters (fingers inside mouth, gripping a specific item)
- cropped views ("only upper torso visible, lower body out of frame")

TYPE — exactly one of:
- portrait (2:3, solo character / outfit reveal)
- landscape (3:2, wide environment / establishing)
- closeup (4:5, face / strong emotion / intimacy)
- scene (~17:10, multi-character action / combat / group)
- square (1:1, vignette / bust)

PROMPT STRUCTURE (single unbroken paragraph inside prompt="..."):

1. Style anchor: "@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting."

2. Rating from current prose: "Safe-for-work content." | "Suggestive content with partial nudity." | "Explicit adult content showing [act]."

3. Scene (1-2 sentences). Location + 2-5 details + time-of-day lighting + light direction. For COMPLEX scenes, name objects that body parts will anchor to (bedpost, windowsill, table edge).

4. Camera: shot type (extreme closeup / closeup / cowboy waist-up / medium full-body / wide full-environment / extreme wide) + angle (eye-level / low / high / dutch / side / from-behind). For FPP add "first-person POV from {{user}}'s eyes". For cropped views state what's visible AND what's cropped.

5. Count: "There are exactly N characters in this scene, no extra people, no duplicate characters."

6. Per character paragraph starting "FullName (POSITION):" covering:
   (a) Species + franchise — e.g. "goblin (original character)", "human".
   (b) GENDER + apparent age — ALWAYS explicit: "adult female", "young male", "elderly nonbinary humanoid". Never omit.
   (c) Body — height + build + bust/dick/ass + waist + thighs VERBATIM from VIR. State limb status only when NON-standard: "left arm amputated above elbow", "wheelchair-bound, both legs paralysed". Skip for fully-limbed standard bodies.
   (d) Hair — colour + length + style + texture; add detail (parting / bangs / how ponytail falls) only when relevant or when card specifies.
   (e) Eyes — colour + shape + gaze direction.
   (f) Face — skin tone, marks, expression.
   (g) Non-human traits — tail/wings/horns/ears/fur/scales VERBATIM.
   (h) Outfit — pieces with colours + materials. Footwear stated. Underwear only if visible / removed.
   (i) Accessories + equipment.
   (j) POSE — name the action plainly for simple poses ("standing beside the bed", "kneeling between his thighs giving a blowjob"). For COMPLEX poses, anchor each non-default body part to a reference: "left hand cupping the back of his neck", "right knee on the floor with left foot tucked under right thigh". Don't over-specify simple standing.

7. Multi-char only — interaction line. For SIMPLE acts: name the act + names + plain geometry ("Arika kneeling in front of ETSVin, her mouth around his erect penis, both her hands gripping his thighs"). For COMPLEX interactions: anchor each contact point.

8. Closer: "All N characters are visible in the frame at their stated positions; no extra people or duplicate versions are present."

CRITICAL LOCKS:
- GENDER explicit per character.
- Copy hair / eyes / body / outfit / non-human features VERBATIM from VIR data.
- Limb status only when non-standard (otherwise omit, models default to fully-limbed).
- Each character paragraph self-contained; no pronouns crossing paragraphs.
- Position labels: Left / Right / Centre / Foreground / Midground / Background.
- Rear view → no breasts/front; Front view → no ass/back; never mix incompatible views.

================================================================================
SIMPLE EXAMPLE — single character, standard pose, ~600 chars
================================================================================
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Suggestive content with partial nudity. Inside a candlelit inn room at dusk, warm orange glow from an oil lamp, a four-poster bed with rumpled linens. Medium full-body shot, eye-level. There are exactly 1 characters in this scene, no extra people, no duplicate characters. Belne (centre): goblin (original character), adult female, 147 cm petite curvaceous with large G-cup breasts, slim waist, thick thighs, waist-length dark green hair tied in a high ponytail, large round orange eyes looking at the viewer, light mint-green skin, pointed ears, beige short-sleeved cotton tunic with a thin brown leather belt at the waist, brown leather sandals, small brass hoop earrings, standing beside the bed with both hands clasped at her waist, parted lips, lifted brows. All 1 characters are visible at their stated positions; no extra people or duplicate versions are present." type="portrait">

================================================================================
SIMPLE EXAMPLE — single character, standard sex act, ~700 chars
================================================================================
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content showing a blowjob. Inside the same candlelit inn room at dusk, soft amber lamp light, the four-poster bed visible in the background. Closeup waist-up shot, eye-level from the side. There are exactly 2 characters in this scene, no extra people, no duplicate characters. Belne (left, kneeling): goblin (original character), adult female, 147 cm petite curvaceous with large G-cup breasts, waist-length dark green ponytail falling forward, large orange eyes looking up at his face, light mint-green skin, pointed ears, nude from the waist up with her tunic pooled around her hips. ETSVin (right, standing): human male, adult, athletic build, short brown hair, blue eyes, fair skin, lower half nude with his trousers around his ankles, shirt still on and pulled up to his chest. Interaction: Belne kneeling in front of ETSVin, her mouth around his erect penis with her lips sealed around the shaft, both her hands resting on his thighs. All 2 characters are visible at their stated positions; no extra people or duplicate versions are present." type="closeup">

================================================================================
COMPLEX EXAMPLE — full spatial anchoring, used when geometry actually matters
================================================================================
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Explicit adult content showing a threesome with one character receiving anal from behind and oral in front. Inside a stone temple alcove at midnight, single torch sconce on the wall casting warm orange light from frame right, cold blue moonlight spilling through a high circular window above, a low altar of polished black marble in the foreground draped with crimson silk, key light from torch warm orange on the rear character's back, rim light from moonlight cool blue along the kneeling character's shoulders. Wide full-environment shot, low angle from floor level. There are exactly 3 characters in this scene, no extra people, no duplicate characters. Belne (centre, bent over the altar): goblin (original character), adult female, 147 cm petite curvaceous with large G-cup breasts crushed against the cold black marble of the altar, waist-length dark green ponytail draped forward past the altar edge, large orange eyes squeezed half-shut, light mint-green skin flushed warm pink across her shoulders, pointed ears tilted back, fully nude with her tunic discarded on the floor to her left, palms flat on the altar surface forearms taking her weight, both knees bent and bare feet planted on the stone floor with her hips raised. King Verros (behind Belne, standing): human male, fat balding middle-aged, ruddy skin, gold silk robe parted open and pushed aside at the front, nude from waist down, his left hand gripping Belne's right hip, his right hand gripping her left hip, his erect penis penetrating Belne anally from behind. Marah (front of altar, kneeling on a low cushion): elven female, adult, slim with B-cup breasts, long pale lavender hair coiled around her left shoulder in a loose braid, violet eyes closed, pale skin, pointed ears pinned back, fully nude, kneeling on a red velvet cushion with her right knee planted on the cushion and her left foot folded beneath her right thigh taking partial weight, her face tilted up and her mouth wrapped around Belne's left index and middle fingers which Belne has pushed past Marah's lips up to the second knuckle. Interaction: King Verros's hips pressed against Belne's ass with anal penetration, Belne's left hand pushed into Marah's mouth with two fingers between Marah's teeth, Belne's right arm extended forward palm flat on the altar bracing her weight, Marah's both hands gripping the front edge of the altar. All 3 characters are visible at their stated positions; no extra people or duplicate versions are present." type="scene">`;
