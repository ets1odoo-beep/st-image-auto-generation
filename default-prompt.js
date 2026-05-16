// Default Prompt Template — pic-tag emission rules + one example.
// Written for modern high-adherence SD models (Anima Base 1.0+, Pony XL,
// Illustrious, etc.) that parse spatial relationships between body parts,
// objects, and other characters. Treat the prompt like describing the scene
// to a blind person who must reconstruct it physically — every hand has a
// destination, every leg has a surface, every cropped character has a clear
// occlusion source.
export const DEFAULT_PROMPT = `Emit \`<pic prompt="..." type="TYPE">\` tags inline in the response whenever a visual beat warrants an image — new scene, outfit reveal, strong emotion, combat, group shot, intimate moment. Place each pic AT the beat it depicts, not batched at the end. No markdown image syntax, no "Image Prompt:" text — only the <pic> tag form.

CORE PRINCIPLE — SPATIAL ANCHORING
Modern SD models have strong prompt adherence. They parse "left hand resting on the bedpost", "index finger inside her mouth", "right knee on the floor with calf folded under", "lower half of her body hidden behind the dresser, only torso and head visible". Use this. Every major body part should be anchored to something concrete: an environment object, the floor/ground, or another character's body part. Generic phrasing ("standing with hands at sides") wastes the model's capability — be specific about WHERE each limb is and WHAT it touches.

TYPE — exactly one of:
- portrait (2:3, solo character / outfit reveal)
- landscape (3:2, wide environment / establishing)
- closeup (4:5, face / strong emotion / intimacy)
- scene (~17:10, multi-character action / combat / group)
- square (1:1, vignette / bust)

PROMPT STRUCTURE (single unbroken paragraph inside prompt="..."):

1. Style anchor: "@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting."

2. Rating from current prose: "Safe-for-work content." | "Suggestive content with partial nudity." | "Explicit adult content showing [act]."

3. Scene (1-2 sentences). Describe the location as if to a blind person: exact location type + 3-5 concrete objects with their materials/conditions + time-of-day lighting + light direction (key / rim / ambient / fill). Name objects that body parts will later anchor to (bedpost, windowsill, table edge, floor, chair arm, doorframe).

4. Camera: shot type (extreme closeup / closeup / cowboy waist-up / medium full-body / wide full-environment / extreme wide) + angle (eye-level / low / high / dutch / side / from-behind). For FPP add "first-person POV from {{user}}'s eyes". For partial/cropped views explicitly state "only [upper torso / lower body / left side / etc.] visible, rest cropped out of frame".

5. Count: "There are exactly N characters in this scene, no extra people, no duplicate characters."

6. Per character paragraph starting "FullName (POSITION):" covering — in this order:
   (a) Species + franchise — e.g. "goblin (original character)", "human (Final Fantasy 7)".
   (b) GENDER + apparent age — ALWAYS state explicitly: "adult female", "young male", "elderly nonbinary humanoid". Never omit. Models confuse gender when it's only implied by pronouns.
   (c) Body — height + build + bust/dick/ass size + waist + thighs VERBATIM from VIR. State limb completeness: "all four limbs intact" OR "left arm amputated above elbow with leather stump cap" OR "wheelchair-bound, both legs paralysed and braced". Don't assume completeness — say it.
   (d) Hair — colour + length + style + texture + parting + bangs/fringe type + tie/clip details + which way the ponytail/braid falls (e.g. "tail draped over right shoulder", "braid coiled around left ear").
   (e) Eyes — colour + shape + gaze direction (looking at viewer / down-left / up at partner / closed / half-lidded) + state (clear / teary / glassy / pupils dilated).
   (f) Face — skin tone, brow shape, lip detail, marks (scars/tattoos/piercings/freckles), expression with physical cues (brow position, mouth state, jaw tension).
   (g) Non-human traits — tail/wings/horns/ears/fur/scales VERBATIM. Anchor each: "tail wrapped around her right thigh", "left wing extended brushing the ceiling beam", "pointed ears tilted forward toward speaker".
   (h) Outfit — layer-by-layer top to bottom with exact colours, materials, fit, condition, and what's worn UNDER each piece if relevant. Footwear explicit (or "barefoot"). Underwear visibility explicit.
   (i) Accessories + equipment — exact material, colour, anchoring point ("brass hoop earring through left earlobe", "small dagger sheathed at right hip on the belt").
   (j) POSE — head position, torso orientation, every limb anchored to something. Use these patterns:
        • "[limb] resting on / pressed against / draped over / wrapped around / inside / behind / under [object or body part]"
        • "[N fingers] of [left/right] hand [verb] [object/body part]" (e.g. "three fingers of her right hand pressing the loose tunic collar against her collarbone")
        • For sitting / kneeling: state which surface bears weight ("kneeling on the floor with right knee on the wooden plank, left foot tucked under her right thigh, balls of left foot taking weight").
        • For cropped views: state what's visible AND what's cropped ("only upper torso and arms visible above the table edge, lower body cropped out of frame").
        • For partial occlusion: state the occluder ("right leg hidden behind the bedpost, only left leg and both arms visible to viewer").

7. Multi-char only — interaction line with FULL NAMES (never pronouns). Anchor each contact point: "Arika's left hand cupping the back of ETSVin's neck, her right palm flat against his chest at the sternum, her bare knees straddling his hips". For NSFW use plain anatomical geometry, never abstract verbs ("her mouth around his erect penis, lips sealed around the shaft, her right hand wrapped around the base" not "performs oral").

8. Closer: "All N characters are visible in the frame at their stated positions; no extra people or duplicate versions are present."

CRITICAL LOCKS:
- GENDER explicit per character — never rely on pronouns or implication.
- Copy hair / eyes / body / outfit / non-human features VERBATIM from VIR data. Never paraphrase, synonym-swap, or resize.
- Limb completeness explicit — affirm intact or specify amputation/prosthetic/paralysis.
- Each major body part (head, torso, both arms, both hands, both legs, tail/wings if present) anchored to a concrete reference (environment object, ground, or another character's part).
- Each character paragraph self-contained; no pronouns crossing paragraphs.
- Position labels: Left / Right / Centre / Foreground / Midground / Background.
- Rear view → no breasts/front; Front view → no ass/back; never mix incompatible views.
- For cropped/occluded characters: state what's visible AND what's cropped/hidden + the occluder.

EXAMPLE — single character with full spatial anchoring:
<pic prompt="@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting. Suggestive content with partial nudity. Inside a candlelit inn room at dusk, warm orange glow from a single oil lamp on a dark walnut dresser, scattered parchment scrolls and a half-empty pewter wine cup beside the lamp, a four-poster oak bed with rumpled cream linen sheets and a tossed wool blanket spilling onto the wooden floor, a leather travel satchel propped against the foot of the bed, a leaded glass window in the back wall showing fading violet sky with light rain droplets on the panes, key light from the lamp at frame right warm orange casting soft long shadows leftward across the floor, rim light from the window cool blue along her right shoulder and the bedpost. Medium full-body shot, eye-level angle from the foot of the bed. There are exactly 1 characters in this scene, no extra people, no duplicate characters. Belne (centre, kneeling beside the bed): goblin (original character), adult female, apparent twenty years old, 147 cm petite curvaceous build with large G-cup breasts and ample rounded ass and slim waist with thick thighs, all four limbs fully intact with no amputations or prosthetics, waist-length straight dark green hair parted slightly off-centre to the left with the high ponytail tied at the crown using a thin brown leather cord and the tail draping over her right shoulder ending just above her right hip with two thin braids framing the sides of her face starting from her temples and merging into the ponytail, large round orange eyes with thick dark lashes looking up and slightly to the left at the viewer's face, light mint-green skin smooth with warm undertone faintly flushed across her cheeks and the bridge of her small nose, soft-featured face with slightly tapered pointed ears the tips bent gently outward, no visible scars or tattoos, beige short-sleeved loose-weave cotton tunic with a scoop neckline hanging open low enough to show the upper swell of her cleavage and secured loosely at the waist by a thin braided brown leather belt with a small brass buckle, the tunic hem riding up to mid-thigh as she kneels exposing the bottoms of her thighs, brown linen short briefs visible under the hiked tunic, barefoot with the soles of both feet showing dirt smudges, small brass hoop earring through each earlobe, kneeling on the wooden floor with her right knee planted flat on the planks and her left knee tucked under her right thigh with the top of her left foot folded flat against the floorboards taking partial weight, her torso angled toward the viewer with shoulders square, her left forearm resting along the edge of the mattress with her left palm flat on the cream linen sheet and four fingers spread wide, her right hand pressed gently to her own upper chest with the index and middle fingers tracing along the open neckline of the tunic just above her collarbone and the other two fingers curled against her sternum, her pointed ears tilted slightly forward, her lips parted as if mid-breath and her dark eyebrows lifted in soft surprise. All 1 characters are visible at their stated positions; no extra people or duplicate versions are present." type="portrait">`;
