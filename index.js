// The main script for the extension
// The following are examples of some basic extension functionality

//You'll likely need to import extension_settings, getContext, and loadExtensionSettings from extensions.js
import { extension_settings, getContext } from '../../../extensions.js';
//You'll likely need to import some other functions from the main script
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    updateMessageBlock,
    extension_prompt_types,
    extension_prompt_roles,
    chat_metadata,
    saveMetadata,
} from '../../../../script.js';
import { appendMediaToMessage } from '../../../../script.js';
import { regexFromString } from '../../../utils.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { DEFAULT_PROMPT, DEFAULT_PROMPT_ANIMA, DEFAULT_PROMPT_KREA2, PROFILE_DEFAULT_PROMPTS } from './default-prompt.js';
import { getTokenCountAsync } from '../../../tokenizers.js';

// 扩展名称和路径
const extensionName = 'st-image-auto-generation';
// /scripts/extensions/third-party
const extensionFolderPath = `/scripts/extensions/third-party/${extensionName}`;

// 插入类型常量
const INSERT_TYPE = {
    DISABLED: 'disabled',
    INLINE: 'inline',
    NEW_MESSAGE: 'new',
    REPLACE: 'replace',
};

/**
 * Escapes characters for safe inclusion inside HTML attribute values.
 * @param {string} value
 * @returns {string}
 */
function escapeHtmlAttribute(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Image profiles ──────────────────────────────────────────────────────────
// Manual selector for which picture model the chat-completion preset writes
// for. It changes what this extension injects and how it processes pic prompts;
// it never touches the core Image Generation (sd) workflow, style or prefix.
//   anima - Qwen3-0.6B encoder: tag clause + PIC_LOOK_SHORT rows, 1800-char cap,
//           negations stripped (the small encoder paints the negated noun)
//   krea2 - Qwen3-4B encoder: full PIC_LOOK rows, "no text" closer, 6000 cap,
//           negations kept (Krea 2 understands them)
// Neither profile carries an artist or style tag (no @xlvxp): qualityPrefix is
// empty and off for both; style lives in the core Image Generation prefix.
const PROFILE_NAMES = ['krea2', 'anima'];
const PROFILE_DEFAULTS = {
    anima: {
        prompt: DEFAULT_PROMPT_ANIMA,
        qualityPrefix: '',
        qualityPrefixAuto: false,
        resolutionProfile: 'hd_1mp',
        noTextSuffix: false,
        lookRow: 'short',
        maxPromptChars: 1800,
        stripNegations: true,
    },
    krea2: {
        prompt: DEFAULT_PROMPT_KREA2,
        qualityPrefix: '',
        qualityPrefixAuto: false,
        resolutionProfile: 'krea_1_5mp',
        noTextSuffix: true,
        lookRow: 'full',
        maxPromptChars: 6000,
        stripNegations: false,
    },
};
function profileLabel(name) { return name === 'anima' ? 'Anima' : 'Krea2'; }
function getProfileName() {
    const p = String(extension_settings[extensionName]?.profile || '').toLowerCase();
    return p === 'anima' ? 'anima' : 'krea2';
}
// Active profile merged over its defaults, so a missing sub-key falls back.
function getActiveProfile() {
    const name = getProfileName();
    const stored = extension_settings[extensionName]?.profiles?.[name] || {};
    return { name, ...PROFILE_DEFAULTS[name], ...stored };
}
function ensureProfiles(cfg) {
    let changed = false;
    if (!cfg.profiles || typeof cfg.profiles !== 'object') { cfg.profiles = {}; changed = true; }
    for (const name of PROFILE_NAMES) {
        if (!cfg.profiles[name] || typeof cfg.profiles[name] !== 'object') { cfg.profiles[name] = {}; changed = true; }
        for (const [key, value] of Object.entries(PROFILE_DEFAULTS[name])) {
            if (cfg.profiles[name][key] === undefined) { cfg.profiles[name][key] = value; changed = true; }
        }
    }
    if (!PROFILE_NAMES.includes(cfg.profile)) { cfg.profile = 'krea2'; changed = true; }
    return changed;
}
// promptInjection.prompt mirrors the active profile's template so older code
// paths and the loader's sentinel checks keep reading one place.
function mirrorActivePrompt(cfg) {
    const name = PROFILE_NAMES.includes(cfg.profile) ? cfg.profile : 'krea2';
    const prompt = cfg.profiles?.[name]?.prompt;
    if (typeof prompt === 'string' && cfg.promptInjection) cfg.promptInjection.prompt = prompt;
}

// 默认设置
const defaultSettings = {
    profile: 'krea2',
    profiles: JSON.parse(JSON.stringify(PROFILE_DEFAULTS)),
    insertType: INSERT_TYPE.DISABLED,
    defaultType: 'portrait',
    resolutionPresets: {
        portrait:  { width: 512, height: 768 },
        landscape: { width: 768, height: 512 },
        closeup:   { width: 512, height: 640 },
        scene:     { width: 768, height: 448 },
        square:    { width: 512, height: 512 },
    },
    promptInjection: {
        enabled: true,
        prompt: DEFAULT_PROMPT,
        // Quote-aware regex that tolerates the SAME quote char embedded in the value.
        // Four branches cover escaped/ordinary double and single quotes; the first
        // non-empty capture wins downstream (see extractPromptFromPicMatch).
        //   - Older [^"']* truncated at the first apostrophe ("ETSVin's shirt" → "ETSVin").
        //   - Then [^"]* truncated at the first embedded double-quote: a height like
        //     5'3" closed the value early, so the rest of the prompt was DROPPED
        //     (the tag still matched/hid, but only the text before 5'3" was generated).
        // Fix: capture lazily ([^>]*?, never crossing the tag's `>`) and accept a
        // closing quote ONLY when it is followed by the next attribute (name=) or the
        // tag end (lookahead). An interior 5'3" is followed by ` tall...`, not an
        // attribute/`>`, so it is NOT treated as the close — the full value survives.
        // Accept normal tags (<pic ...>, <image ...>) and common malformed
        // type-first tags (<closeup pic prompt="...">). SillyTavern may hide
        // unknown empty tags while this extension misses them, so no render
        // job starts unless all emitted shapes are parsed here.
        // The `i` flag is REQUIRED: models intermittently capitalize the tag
        // (<Pic prompt=...>), e.g. at sentence start. HTML tags are case-insensitive
        // so it renders/hides the same, but a case-sensitive /g regex silently
        // misses <Pic> → no image generated. Always keep the `i` flag.
        // Some models JSON-escape attribute delimiters in visible text and emit
        // prompt=\"...\" type=\"scene\". Keep those literal backslashes in the
        // match so REPLACE mode can still replace the exact original tag.
        regex: String.raw`/<(?:(?:pic|image)|(?:(?:portrait|landscape|closeup|scene|square)(?=[^>]*\b(?:pic|image)\b)))\b[^>]*?\sprompt=(?:\\"([^>]*?)\\"|\\'([^>]*?)\\'|"([^>]*?)"|'([^>]*?)'|"([^>"]*?)(?=<\/(?:pic|image)>))(?=\s*(?:[\w-]+\s*=|\/?>|<\/(?:pic|image)>))[^>]*\/?>/gi`,
        position: 'deep_user', // legacy UI field; runtime forces user-role injection
        depth: 1, // 1 = one slot BEFORE the user's latest message, so the real
                  // user input stays the final-recency turn. depth 0 (absolute
                  // last) buried the user's input behind this ~5k-token rules
                  // wall, which made weak models ignore the input and re-send
                  // their previous reply verbatim.
    },
    queueConcurrency: 1,
    generationDelayMs: 0,
    skipStreamingPregeneration: false,
    debug: false,
    resolutionProfile: 'custom',
    // v1.5 quality + safety settings
    negativePrompt: 'duplicate, watermark, text, lowres, blurry, deformed hands, extra limbs, multiple heads, jpeg artifacts',
    // Empty and off: "@xlvxp, masterpiece, very aesthetic" were Anima/booru
    // tokens the Krea2 encoder cannot read. Style now lives in one place, the
    // Image Generation "Common prompt prefix", which is visible in the UI.
    qualityPrefix: '',
    qualityPrefixAuto: false,  // auto-prepend qualityPrefix if missing from the prompt
    sanitizePrompts: true,     // strip SD weight syntax, negations, URLs, fancy quotes
    virDriftWarn: false,       // warn when a VIR character is named without appearance terms
    enableDedupe: true,        // same prompt+type twice in one reply → one gen, two embeds
    // OFF by user decision: an invented pic is worse than no pic. A tagless
    // reply is usually a truncated one, and a prompt synthesised from prose
    // produced images that did not match the scene. No tag now means no image.
    // The machinery below still works if this is switched back on: it only ever
    // fires on a reply with zero pics, never pads a reply that has some, and
    // never invents one for a greeting.
    allowFallbackTagInsertion: false,
    fallbackOnlyWhenZero: true,
    maxPicsPerMessage: 5,              // ceiling used only when fallback insertion is re-enabled
    loraTriggers: {},          // map<characterName, triggerString>; prepended when name found in prompt
    lastPicAudit: {},
};

const RESOLUTION_PROFILES = {
    low_vram: {
        portrait:  { width: 384, height: 576 },
        landscape: { width: 576, height: 384 },
        closeup:   { width: 384, height: 480 },
        scene:     { width: 576, height: 336 },
        square:    { width: 448, height: 448 },
    },
    balanced: JSON.parse(JSON.stringify(defaultSettings.resolutionPresets)),
    quality: {
        portrait:  { width: 640, height: 960 },
        landscape: { width: 960, height: 640 },
        closeup:   { width: 640, height: 800 },
        scene:     { width: 960, height: 560 },
        square:    { width: 768, height: 768 },
    },
    hd_1mp: {
        portrait:  { width: 832, height: 1216 },
        landscape: { width: 1216, height: 832 },
        closeup:   { width: 896, height: 1152 },
        scene:     { width: 1344, height: 768 },
        square:    { width: 1024, height: 1024 },
    },
    ultra_1_5mp: {
        portrait:  { width: 1024, height: 1536 },
        landscape: { width: 1536, height: 1024 },
        closeup:   { width: 1088, height: 1408 },
        scene:     { width: 1664, height: 896 },
        square:    { width: 1216, height: 1216 },
    },
    max_2mp: {
        portrait:  { width: 1152, height: 1728 },
        landscape: { width: 1728, height: 1152 },
        closeup:   { width: 1280, height: 1536 },
        scene:     { width: 1920, height: 1024 },
        square:    { width: 1408, height: 1408 },
    },
    // Krea 2 profiles: the ratios Krea's API accepts (portrait 2:3, closeup 4:5,
    // landscape 3:2, scene 16:9, square 1:1) at exact multiples of 16 px (the
    // Krea 2 latent unit), so no side is rounded to a 64-px bucket and the scene
    // frame is a true 16:9 instead of 15:8. Wider than 16:9 squashes full bodies
    // (seed-1947 probe: 15:8 and 16:9 drew a shorter, stockier figure than 3:2).
    krea_1mp: {
        portrait:  { width: 832, height: 1248 },
        landscape: { width: 1248, height: 832 },
        closeup:   { width: 912, height: 1136 },
        scene:     { width: 1360, height: 768 },
        square:    { width: 1024, height: 1024 },
    },
    krea_1_5mp: {
        portrait:  { width: 1024, height: 1536 },
        landscape: { width: 1536, height: 1024 },
        closeup:   { width: 1120, height: 1408 },
        scene:     { width: 1680, height: 944 },
        square:    { width: 1248, height: 1248 },
    },
    krea_2mp: {
        portrait:  { width: 1184, height: 1776 },
        landscape: { width: 1776, height: 1184 },
        closeup:   { width: 1296, height: 1616 },
        scene:     { width: 1936, height: 1088 },
        square:    { width: 1440, height: 1440 },
    },
    krea_3mp: {
        portrait:  { width: 1440, height: 2160 },
        landscape: { width: 2160, height: 1440 },
        closeup:   { width: 1584, height: 1984 },
        scene:     { width: 2368, height: 1328 },
        square:    { width: 1776, height: 1776 },
    },
};

function debugLog(...args) {
    if (extension_settings?.[extensionName]?.debug) {
        console.log(`[${extensionName}]`, ...args);
    }
}

// ── Per-chat disable ────────────────────────────────────────────────────────
// When set in the current chat's metadata, this chat skips:
//   - the pic-tag prompt injection (main + any reminder slot)
//   - streaming pre-generation
//   - the MESSAGE_RECEIVED final-pass image generation
// Other chats are unaffected. Stored in chat_metadata so it survives reload.
const CHAT_DISABLED_KEY = 'imageAutoChatDisabled';

function isChatDisabled() {
    return Boolean(chat_metadata?.[CHAT_DISABLED_KEY]);
}

function setChatDisabled(disabled) {
    if (disabled) chat_metadata[CHAT_DISABLED_KEY] = true;
    else delete chat_metadata[CHAT_DISABLED_KEY];
    try { saveMetadata?.(); } catch (err) { console.warn(`[${extensionName}] saveMetadata failed`, err); }
}

function normalizePromptKey(prompt) {
    return String(prompt || '').replace(/\s+/g, ' ').trim();
}

function getGenerationCommand() {
    const sdCommand = SlashCommandParser.commands['sd'];
    if (sdCommand && typeof sdCommand.callback === 'function') return sdCommand;
    const imagineCommand = SlashCommandParser.commands['imagine'];
    if (imagineCommand && typeof imagineCommand.callback === 'function') return imagineCommand;
    return null;
}

function encodeMarkdownUrl(url) {
    // Markdown image syntax: ![alt](url "title") — `"` and `'` end the URL and
    // start a title; `)` ends the URL; `<` `>` form an autolink; `[` `]` end
    // the image syntax. Card names like  `Isadora "Izzy" Kessel | ... (now ...)`
    // survive server-side sanitize-filename's `(` `)` (those aren't stripped)
    // and reach the client URL where they break the markdown parse.
    // NOTE: only STRAIGHT quotes are stripped by sanitize-filename. CURLY quotes
    // (“ ” ‘ ’), em-dashes, accented letters, CJK, etc. are LEGAL filename chars,
    // so a card like `Margaret “Maggie” Whitmore` keeps the curly quotes in both
    // the on-disk path and the URL the server returns. Raw non-ASCII in the
    // markdown URL corrupts the rendered <img>, so the trailing pass below
    // percent-encodes every non-ASCII run (kept together so surrogate pairs /
    // emoji encode as one code point and encodeURIComponent never throws).
    return String(url || '')
        // % MUST come first — encoding it after the others would re-escape
        // the %20/%28/etc we just inserted. Only encode bare % that is NOT
        // already part of a percent-encoded triplet (e.g. %20, %28).
        .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
        .replace(/ /g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/"/g, '%22')
        .replace(/'/g, '%27')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
        .replace(/\[/g, '%5B')
        .replace(/\]/g, '%5D')
        .replace(/\|/g, '%7C')
        // # is the URL fragment separator — must be encoded or the browser
        // truncates the request path at the first #. Chat names like
        // "(US Mommies #41)" silently 404 without this.
        .replace(/#/g, '%23')
        // ? would be parsed as the start of a query string.
        .replace(/\?/g, '%3F')
        // Any remaining non-ASCII char (curly quotes “ ” ‘ ’, em-dash —, accents,
        // CJK, emoji). Match RUNS so surrogate pairs stay intact for
        // encodeURIComponent. ASCII (incl. the path `/`, `@`, `_`, `-`, `.` we
        // rely on) is untouched, so existing working URLs are unaffected.
        .replace(/[^\x00-\x7F]+/g, (run) => encodeURIComponent(run));
}

// Returns the current character's SD positive prompt prefix, or '' if none / in a group.
function getCharacterSDPrefix() {
    const ctx = getContext();
    if (!ctx || ctx.groupId) return '';
    const sdSettings = extension_settings?.sd;
    if (!sdSettings?.character_prompts) return '';
    const char = ctx.characters?.[ctx.characterId];
    if (!char?.avatar) return '';
    const key = char.avatar.replace(/\.[^/.]+$/, '');
    return (sdSettings.character_prompts[key] || '').trim();
}

// ── v1.5 prompt transforms ──────────────────────────────────────────────────
// Order at /sd call time:
//   raw prompt → sanitizeForAnimaQwen → ensureQualityPrefix → applyLoraTriggers
//                → prepend char SD prefix → call /sd with negative=
// Sanitize first so weight-syntax / negations are gone before the quality
// prefix scan, otherwise dedupe of the prefix can miss because of (xxx:1.2)
// noise interleaved with the prefix text.

// True negations: drop the word and the whole phrase it negates, stopping at
// punctuation or a conjunction ("no shoes and bare feet" keeps "and bare
// feet"; "without a top and skirt pushed up" keeps the skirt). A two-word cap
// left the noun behind: "no visible body hair" became "hair" and rendered it.
const NEG_WORD_RE = /\b(?:no|not|without|never|avoid)\b(?:\s+(?!(?:and|but|with|while|or)\b)[\w'’-]+)*/gi;
// Limiters, not negations: "wears only a white lace thong" must keep the thong.
// These were once in NEG_WORD_RE, which deleted the garment along with the word.
const LIMITER_WORD_RE = /\b(?:only|exactly|just)\s+/gi;
const SD_WEIGHT_PAREN_RE = /\(([^()]*?):\s*-?\d+(?:\.\d+)?\s*\)/g;
const SD_WEIGHT_BRACKET_RE = /\[([^\[\]]*?):\s*-?\d+(?:\.\d+)?\s*\]/g;
// "height", "width" and "model" are ordinary prompt words ("height: 170 cm",
// "a fashion model") and were being deleted; only real generation parameters
// are stripped now.
const GEN_PARAM_RE = /\b(?:steps|seed|cfg|sampler|scheduler|negative[_ ]?prompt|variant)\s*[:=]\s*\S+/gi;

function sanitizeForAnimaQwen(prompt) {
    const cfg = extension_settings[extensionName] || {};
    if (cfg.sanitizePrompts === false) return String(prompt || '').trim();
    let text = String(prompt || '');
    if (!text) return '';

    // 1) URLs (would otherwise paint themselves as text into the image)
    text = text.replace(/https?:\/\/\S+/gi, ' ');
    // 2) SD weight syntax — keep the inner word, drop the multiplier
    text = text.replace(SD_WEIGHT_PAREN_RE, '$1').replace(SD_WEIGHT_BRACKET_RE, '$1');
    // 3) Generation params accidentally embedded
    text = text.replace(GEN_PARAM_RE, ' ');
    // 4) Fancy quotes → straight; collapse straight doubles to singles
    text = text.replace(/[“”]/g, "'").replace(/"/g, "'");
    // 5) Negation phrases, Anima profile only: its small Qwen3-0.6B encoder paints
    //    the noun, so "no extra people" → extra people. Krea 2's Qwen3-4B encoder
    //    understands negations, so the Krea2 profile keeps them as written.
    const stripNeg = getActiveProfile().stripNegations === true;
    if (stripNeg) text = text.replace(LIMITER_WORD_RE, '');
    const negMatches = stripNeg ? text.match(NEG_WORD_RE) : null;
    if (negMatches?.length) {
        debugLog(`[${extensionName}] sanitizer stripped ${negMatches.length} negation phrase(s):`, negMatches);
        text = text.replace(NEG_WORD_RE, ' ');
        // A negated phrase after a connector left the connector dangling ("..., with no other
        // person in frame." became "..., with."); drop the connector and the empty comma.
        text = text.replace(/\s*,?\s+(?:with|and|but|or|while|plus)\s*(?=[.,;])/gi, '').replace(/,\s*(?=[.;])/g, '').replace(/(?:\s*,){2,}/g, ',');
    }
    // 5b) Makeup wear words draw as injuries (smudged lipstick -> blood on the
    //     chin, dark circles under smudged mascara -> a black eye). Keep the
    //     colour, drop the wear; tears stay as tracks on the cheeks.
    if (cfg.fixMakeupWords !== false) {
        text = text
            // a print left on someone stays a print
            .replace(/\b(?:a\s+)?(?:faint\s+red\s+)?(?:lipstick|lip)\s+(?:print|mark|smear|smudge)s?\s+(?:on|across|at)\s+(his|her|their)\s+([\w-]+)/gi, 'a faint red lip print on $1 $2')
            .replace(/\b(?:her|his|their)?\s*(?:[\w-]+\s+)?lipstick\s+(?:smeared|smudged|printed|pressed|left)\s+(?:across|on|onto|against|at)\s+(his|her|their)\s+([\w-]+)/gi, 'a faint red lip print on $1 $2')
            // wear words on the wearer's own makeup: keep the colour word only
            .replace(/\b((?:[\w-]+\s+){0,2}lipstick|lip ?gloss|lip ?stain)\s+(?:is\s+)?(?:smudged|smeared|stained|streaked|faded|worn off|bleeding|messy|ruined)(?:\s+(?:at|on|across|around|to|over|down)\s+[^,.;]*)?/gi, '$1')
            .replace(/\b(?:smudged|smeared|streaked|running|ruined|messy|bleeding)\s+(lipstick|lip ?gloss|mascara|eyeliner|makeup|eye makeup)\b/gi, '$1')
            .replace(/\b(lipstick|lip ?gloss|mascara|eyeliner|makeup)\s+(?:smudged|smeared|streaked|running|ruined|bleeding)(?:\s+(?:down|under|below|at|on|across|around)\s+[^,.;]*)?/gi, '$1')
            // bruise-like words around the eyes
            .replace(/\b(?:dark|purple|dark purple|deep|heavy|bruised|bruise-like)\s+(?:circles|shadows|rings)\s+(?:under|beneath|below)\s+(?:her|his|their|the|them|smudged\s+)?\s*(?:eyes?|lids|mascara|them)?\b/gi, 'tired eyes')
            .replace(/\b(?:red|pink)-rimmed(?:\s+[\w-]+)?\s+eyes\b/gi, 'wet eyes');
    }
    // 6) Standalone problem descriptors that cause artifacts. "extra" is kept as
    //    an ordinary word ("extra large breasts", "extra long hair"); only the
    //    negative-prompt leaks about anatomy are removed.
    text = text.replace(/\b(duplicate|duplicates|multiple\s+heads|extra\s+(?:limbs?|fingers?|digits?|heads?|arms?|legs?|hands?|feet|eyes|people|persons?))\b/gi, ' ');
    // 6b) Field labels at a sentence start ("Style:", "Lighting:", "Expression:") are dropped: Krea 2's Qwen3-VL
    //     encoder reads labels as text to draw (Comfy-Org template PR #1313), and the prose works the same without them.
    text = text.replace(/\b(His|Her|Their)\s+expression:\s+/g, '$1 face shows ')
               .replace(/(^|[.!?]\s+)(?:[A-Z][a-z]+(?:\s[a-z]+)?):\s+(?=[A-Za-z])/g, '$1');
    // 7) Whitespace / dangling punctuation cleanup
    text = text.replace(/\s+([.,;:!?])/g, '$1')
               .replace(/[.,;:]\s*([.,;:])/g, '$1')
               .replace(/\s+/g, ' ')
               .trim();
    // 8) Runaway guard, per profile. Anima's small encoder stops reading long
    //    prompts (1800); the Krea2 tokenizer is uncapped (comfy/text_encoders/
    //    krea2.py → Qwen3VL, max_length 99999999), and cutting at 1800 was
    //    dropping the last person's clothing and the room line (6000). Cut on a
    //    sentence end so a runaway prompt never ends mid-description.
    const MAX_PROMPT_CHARS = Number(getActiveProfile().maxPromptChars) || 6000;
    if (text.length > MAX_PROMPT_CHARS) {
        const head = text.slice(0, MAX_PROMPT_CHARS);
        const sentenceEnd = head.lastIndexOf('. ');
        const space = head.lastIndexOf(' ');
        const cut = sentenceEnd > MAX_PROMPT_CHARS * 0.8 ? sentenceEnd + 1 : (space > 0 ? space : MAX_PROMPT_CHARS);
        text = head.slice(0, cut).trim();
    }
    return text;
}

function ensureQualityPrefix(prompt) {
    const cfg = extension_settings[extensionName] || {};
    // Per profile; both bundled profiles keep this empty and off (no artist
    // or style tag is ever added here), so this is a no-op unless the user
    // sets a prefix in settings.json for a profile.
    const prof = getActiveProfile();
    const auto = prof.qualityPrefixAuto !== undefined ? prof.qualityPrefixAuto : cfg.qualityPrefixAuto;
    if (!auto) return prompt;
    const prefix = String((prof.qualityPrefix !== undefined ? prof.qualityPrefix : cfg.qualityPrefix) || '').trim();
    if (!prefix) return prompt;
    // If the prompt already opens with the prefix's first token, treat the
    // prefix as handled and do NOT inject; injection here is only a fallback
    // for replies that omit a user-configured prefix entirely.
    const firstTok = prefix.split(',')[0].trim().toLowerCase();
    if (firstTok) {
        const headStart = String(prompt || '').replace(/^[\s"']+/, '').slice(0, firstTok.length + 2).toLowerCase();
        if (headStart.startsWith(firstTok)) return String(prompt || '').trim();
    }
    // Cheap match: first ~80 chars contain the prefix verbatim
    const head = String(prompt || '').slice(0, Math.max(prefix.length + 40, 120)).toLowerCase();
    const pfxLower = prefix.toLowerCase();
    if (head.includes(pfxLower)) return prompt;
    // Detect a duplicate-with-trailing-dot variant (prompt re-emits same prefix without period)
    const pfxNoDot = pfxLower.replace(/\.+$/, '');
    if (pfxNoDot && head.includes(pfxNoDot)) return prompt;
    return `${prefix} ${String(prompt || '').trim()}`.trim();
}

function applyLoraTriggers(prompt) {
    const cfg = extension_settings[extensionName] || {};
    const map = cfg.loraTriggers || {};
    const names = Object.keys(map);
    if (!names.length) return prompt;
    const body = String(prompt || '');
    const lc = body.toLowerCase();
    const triggers = [];
    for (const name of names) {
        const trig = String(map[name] || '').trim();
        if (!trig) continue;
        const needle = String(name || '').toLowerCase().trim();
        if (!needle) continue;
        // Case-insensitive whole-word-ish match (allow trailing 's' or punctuation)
        const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(lc) && !body.includes(trig)) triggers.push(trig);
    }
    if (!triggers.length) return body;
    return `${triggers.join(' ')} ${body}`.trim();
}

async function warnVirDrift(prompt) {
    const cfg = extension_settings[extensionName] || {};
    if (!cfg.virDriftWarn) return;
    if (typeof window.ff4VirGetPicCopies !== 'function') return;
    try {
        const all = await window.ff4VirGetPicCopies();
        const lc = String(prompt || '').toLowerCase();
        const APPEARANCE_RE = /\b(hair|eyes|skin|wears|wearing|naked|tall|short|build|body|fur|scales)\b/i;
        for (const [, value] of Object.entries(all || {})) {
            const name = String(value?.name || '').toLowerCase().trim();
            if (!name || name.length < 3) continue;
            if (!lc.includes(name)) continue;
            // Check 120 chars around the name mention for appearance terms
            const idx = lc.indexOf(name);
            const window = lc.slice(Math.max(0, idx - 60), idx + name.length + 120);
            if (!APPEARANCE_RE.test(window)) {
                console.warn(`[${extensionName}] VIR drift: "${value?.name}" named without appearance terms — model may drift.`);
            }
        }
    } catch (err) {
        debugLog('warnVirDrift failed', err?.message);
    }
}

// Compose the final SD prompt from the AI's raw prompt text.
// FF4 look lock: the model paraphrased the stored identity row differently in
// every picture and dropped words (the lipstick), and each rewording gave the
// encoder a new face. Replace each "<Name> is <identity>" sentence with the
// stored PIC_LOOK row, keeping the preset's crop filter (close-up: no body
// words; rear view: no face words).
const LOCK_BODY_RE = /\b(chest|breasts?|bust|hips?|belly|stomach|waist|thighs?|legs?|butt|ass|build|curvy|slim|athletic|petite|plump|heavyset|average|muscular|lean|wiry|hands?|feet|shoulders|torso|figure|frame|hourglass|physique|silhouette|(?:tall|short)(?!\s+(?:\w+\s+){0,3}(?:hair|bob|cut|fringe|bangs|beard|nails|lashes|braid|ponytail|curls|locks)))\b/i;
// Fragments that belong to the head stay in a close-up even when they mention a body word
// ("hair falling past her shoulders", "beard down to his chest").
const LOCK_HEAD_RE = /\b(hair|bob|braids?|ponytail|bun|curls|bangs|fringe|locks|dreadlocks|afro|mohawk|beard|moustache|mustache|stubble|lashes|brows?|eyes?|lips?|nose|jaw|cheeks?|cheekbones|chin|face|ears?|horns?|lipstick|makeup|mascara|freckles|mole|scar|glasses)\b/i;
const LOCK_FACE_RE = /\b(face|eyes?|brows?|lashes|lips?|teeth|nose|jaw|cheeks?|cheekbones|lipstick|makeup|mascara|freckles|mole|scar)\b/i;
// Clothing, pose, expression and props that share the identity sentence
// ("...short dark brown hair; he wears a grey t-shirt, a sly grin") are kept:
// the lock replaces only the part before the first of these words.
const LOCK_TAIL_RE = /;|\b(?:wearing|wears|dressed|clad|holds?|holding|grip\w*|carr(?:y|ies|ying)|clutch\w*|grin\w*|smil\w*|smirk\w*|frown\w*|scowl\w*|gaz\w*|glanc\w*|look\w*|star(?:e|es|ing)|flush\w*|blush\w*|parted|pressed|knitted|furrowed|raised|lifted|narrowed|widened|lowered|tilted|turned|leaning|leans|leant|stands?|standing|sits?|sitting|kneel\w*|lying|lies|rest\w*|tears?|sweat\w*)\b/i;
const LOCK_KEEP_RE = /\b(wear\w*|dressed|clad|in an? |blouse|shirt|t-shirt|tee|top|sweater|jumper|hoodie|cardigan|jacket|blazer|tunic|camisole|tank|robe|kimono|coat|vest|uniform|dress|gown|skirt|trousers|pants|jeans|shorts|leggings|slacks|bra|panties|thong|lingerie|stockings|tights|socks|boots|heels|flats|sneakers|shoes|apron|scrubs|suit|towel|bikini|swimsuit|nightgown|pyjamas|pajamas|underwear|briefs|boxers|bodice|corset|cloak|cape|glasses|watch|ring|necklace|earrings|holds?|holding|grip\w*|carr(?:y|ies|ying)|clutch\w*|grin\w*|smil\w*|smirk\w*|frown\w*|scowl\w*|gaz\w*|glanc\w*|look\w*|star(?:e|es|ing)|flush\w*|blush\w*|parted|knitted|furrowed|narrowed|widened|tilted|turned|leaning|leans|stands?|standing|sits?|sitting|kneel\w*|lying|lies|rest\w*|tears?|sweat\w*|naked|nude|bare|topless)\b/i;
const LOCK_POSE_PART_RE = /\b(hands?|arms?|fingers?|fingertips?|palms?|elbows?|knees?|feet|foot|head|face|eyes?|chin|mouth|lips|brows?|cheeks?|wrists?|shoulder)\b/i;
const LOCK_IDENTITY_START_RE = /^(?:adult|young|human|elderly|mature|old|[a-z-]+\s+(?:woman|man|girl|boy|male|female|lady|gentleman)|(?:\w+\s+){0,2}(?:creature|dragon|fox|wolf|cat|dog|elf|orc|goblin|demon|angel|android|robot|slime|anthro|pokemon|pokémon))\b/i;
function lockLookSentences(prompt, copies, opts = {}) {
    let text = String(prompt || '');
    if (!text || !copies || typeof copies !== 'object') return text;
    // Which stored row replaces the identity sentence: the short row under the
    // Anima profile, the full row under Krea2. Decided by the profile setting,
    // not by sniffing the prompt for a rating word.
    const useShort = String(opts.lookRow || getActiveProfile().lookRow) === 'short';
    const head = text.split(/\.\s/)[0].toLowerCase();
    const closeup = /\b(close-up|closeup|face from|from the brows|head and shoulders|face fills)\b/.test(head);
    const rearAll = /\b(from behind|rear view|back to the camera|seen from behind|walking away from the camera)\b/.test(head)
        && !/\b(three-quarter|over (?:her|his|their) shoulder|turned back|turns back|look(?:s|ing)? back|glanc\w* back|face turned|facing the camera)\b/.test(head);
    const rearNames = new Set();
    for (const m of text.matchAll(/\bfrom behind ([A-Z][\w'-]+)|\b([A-Z][\w'-]+)(?:'s)? back(?: is)? to the camera|\bshows ([A-Z][\w'-]+) from behind|\b([A-Z][\w'-]+) (?:walks|walking) away from the camera|\b([A-Z][\w'-]+)[^.;]{0,40}\bwith (?:her|his|their) back to the camera/g)) {
        const n = m.slice(1).find(Boolean); if (n) rearNames.add(n.toLowerCase());
    }
    for (const c of Object.values(copies)) {
        const name = String(c?.name || '').trim();
        if (!name) continue;
        const row = String((useShort && c.look_short) || c.look || '').trim();
        if (!row) continue;
        let frags = row.split(/\s*,\s*/).filter(Boolean);
        // A row head "Nezuko Kamado from Demon Slayer" (full_name + source) replaces the bare name in the locked sentence.
        let headText = '';
        const nameRe = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        const fullName = String(c?.pic_identity || '').split(',')[0].trim();
        if (frags[0] && frags[0].toLowerCase() === name.toLowerCase()) frags.shift();
        // A row head longer than the bare name is the full name ("Merry Evangeline Cunningham") or
        // full name + source ("Nezuko Kamado from Demon Slayer"); it replaces the bare name in the
        // locked sentence. Without this the full name was pasted as a body word: "Merry is a Merry
        // Evangeline Cunningham, human, adult woman".
        else if (frags[0] && (nameRe.test(frags[0]) || (fullName && frags[0].toLowerCase() === fullName.toLowerCase()))) headText = frags.shift();
        if (/^humans?$/i.test(frags[0] || '')) frags.shift();
        if (closeup) frags = frags.filter(f => LOCK_HEAD_RE.test(f) || !LOCK_BODY_RE.test(f));
        const rear = rearNames.size ? rearNames.has(name.toLowerCase()) : rearAll;
        if (rear) frags = frags.filter(f => !LOCK_FACE_RE.test(f));
        if (frags.length < 3) continue;
        const body = frags.join(', ');
        const article = /^[aeiou]/i.test(body) ? 'an' : 'a';
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${esc}\\b((?:[^.]|\\.(?=\\d))*?\\bis\\s+)(?:an?\\s+)?([^.]*?)(?=\\.(?:\\s|$))`, 'gi');
        for (const m of text.matchAll(re)) {
            const span = m[2];
            if (!LOCK_IDENTITY_START_RE.test(span.trim())) continue;
            // Keep clothing, pose, expression and props that share the
            // sentence; without this, "Rebecca is ...; she wears a blouse"
            // lost the blouse and Krea drew her naked.
            let keep = '';
            const b = span.search(LOCK_TAIL_RE);
            if (b >= 0) {
                if (span[b] === ';') keep = span.slice(b);
                else {
                    const before = span.slice(0, b);
                    const cut = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'));
                    keep = cut >= 0 ? span.slice(cut) : ', ' + span.slice(b);
                }
                // Drop tail fragments that are body rows (the stored row already has
                // them); keep clothing, held objects, pose and face-cue fragments.
                const parts = [...keep.matchAll(/([;,])\s*([^;,]+)/g)];
                const kept = parts.filter(m => { const fr = m[2].trim(); return !LOCK_BODY_RE.test(fr) || LOCK_KEEP_RE.test(fr) || LOCK_POSE_PART_RE.test(fr); });
                keep = kept.map(m => m[1] + ' ' + m[2].trim()).join('');
            }
            let mid = m[1].replace(/\s*\bis\s*$/i, '').trim();
            // "Yor Briar from Spy x Family stands camera-left ...; Yor Briar from Spy x Family is":
            // the clause before the last semicolon stays as written; only the head after it is
            // rebuilt, and a mid that repeats the name or the head's remainder is trimmed, so the
            // head is never glued twice ("Yor Briar from Spy x Family Briar from Spy x Family").
            let pre = '';
            const semi = mid.lastIndexOf(';');
            if (semi >= 0) { pre = mid.slice(0, semi + 1) + ' '; mid = mid.slice(semi + 1).trim(); }
            let headOut;
            if (!headText || (pre && /^(?:he|she|they|it)$/i.test(mid))) headOut = name + m[1];
            else {
                if (nameRe.test(mid)) mid = mid.replace(nameRe, '').trim();
                const rest = headText.replace(nameRe, '').trim();
                if (rest && mid.toLowerCase().startsWith(rest.toLowerCase())) mid = mid.slice(rest.length).trim();
                headOut = (pre ? name + ' ' + pre : '') + (mid ? headText + ' ' + mid + ' is ' : headText + ' is ');
            }
            text = text.slice(0, m.index) + headOut + article + ' ' + body + keep + text.slice(m.index + m[0].length);
            break;
        }
    }
    return text;
}
async function lockIdentityLook(prompt) {
    if (typeof window.ff4VirGetPicCopies !== 'function') return prompt;
    if (extension_settings[extensionName]?.lookLock === false) return prompt;
    try {
        const copies = await window.ff4VirGetPicCopies();
        const out = lockLookSentences(prompt, copies, { lookRow: getActiveProfile().lookRow });
        if (out !== prompt) debugLog('look lock rewrote identity sentence(s)');
        return out;
    } catch (err) {
        debugLog('lockIdentityLook failed', err?.message);
        return prompt;
    }
}

function buildEffectivePrompt(rawPrompt) {
    let p = sanitizeForAnimaQwen(rawPrompt);
    p = ensureQualityPrefix(p);
    p = applyLoraTriggers(p);
    p = normalizePromptPeopleCount(p);
    const charPrefix = getCharacterSDPrefix();
    if (charPrefix) {
        // Don't double-prepend a per-character SD prefix that already sits
        // at the head of the prompt (it may repeat a configured quality
        // prefix), which would otherwise yield "prefix, prefix, ...".
        const head = p.slice(0, charPrefix.length + 4).toLowerCase();
        if (!head.startsWith(charPrefix.toLowerCase())) {
            p = `${charPrefix}, ${p}`;
        }
    }
    // Krea 2 profile: the official template's closing sentence, appended last so no cleaner
    // step can touch it; only words the prompt quotes on purpose are meant to be drawn.
    if (getActiveProfile().noTextSuffix && !/pure imagery only/i.test(p)) {
        p = p.replace(/\s*$/, '') + ' Absolutely no text, no typography, no letters, no words, no numbers, no logos, no watermark, no captions, pure imagery only.';
    }
    return p;
}

function normalizePromptPeopleCount(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return text;

    const countPattern = /\b(?:one|two|three|four|five|six|seven|eight|nine|\d+)\s+people?\s+(?:is|are)\s+in the picture\./i;
    if (!countPattern.test(text)) return text;

    const names = new Set();
    const addName = (value) => {
        const name = String(value || '').trim().replace(/\s+/g, ' ');
        if (name.length >= 2) names.add(name);
    };

    for (const match of text.matchAll(/\b([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,4})\s+from\s+[A-Z]/g)) {
        addName(match[1]);
    }
    for (const match of text.matchAll(/\b([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,4}),\s+an original character\b/g)) {
        addName(match[1]);
    }

    const count = names.size;
    if (count < 1) return text;

    const countWord = {
        1: 'One',
        2: 'Two',
        3: 'Three',
        4: 'Four',
        5: 'Five',
        6: 'Six',
        7: 'Seven',
        8: 'Eight',
        9: 'Nine',
    }[count] || String(count);

    return text.replace(
        countPattern,
        `${countWord} ${count === 1 ? 'person is' : 'people are'} in the picture.`,
    );
}

// Extract the image type from a full tag string. Prefer type="...", but also
// recover malformed type-first tags like <closeup pic prompt="...">.
function extractImageType(tagString) {
    if (typeof tagString !== 'string') return null;
    const tagNameType = tagString.match(/^<\s*(portrait|landscape|closeup|scene|square)\b/i);
    if (tagNameType) return tagNameType[1].toLowerCase();
    const m = tagString.match(/\btype\s*=\s*\\?["'](\w+)\\?["']/i);
    if (m) return m[1].toLowerCase();
    const beforePrompt = tagString.split(/\sprompt=/i)[0] || '';
    const bareType = beforePrompt.match(/\b(portrait|landscape|closeup|scene|square)\b/i);
    return bareType ? bareType[1].toLowerCase() : null;
}

function normalizeImageType(imageType) {
    const settings = extension_settings[extensionName] || {};
    const presets = settings.resolutionPresets || defaultSettings.resolutionPresets;
    const defaultType = settings.defaultType || 'portrait';
    return imageType && presets[imageType] ? imageType : defaultType;
}

// Resolve width/height for a given image type using configured presets
function resolveResolution(imageType) {
    const settings = extension_settings[extensionName];
    const presets = (settings && settings.resolutionPresets) || defaultSettings.resolutionPresets;
    const type = normalizeImageType(imageType);
    return presets[type] || { width: 512, height: 512 };
}

// Update the pixel count cell for a preset table row and colour it red if over 0.5 MP
function updatePixelCount(row) {
    const width = parseInt(row.find('.preset-width').val()) || 0;
    const height = parseInt(row.find('.preset-height').val()) || 0;
    const pixels = width * height;
    const cell = row.find('.preset-pixels');
    cell.text(pixels.toLocaleString());
    cell.css('color', pixels > 500000 ? '#e74c3c' : '');
}

// 从设置更新UI
function updateUI() {
    // 根据insertType设置开关状态
    $('#auto_generation').toggleClass(
        'selected',
        extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED,
    );

    // 只在表单元素存在时更新它们
    if ($('#image_generation_insert_type').length) {
        $('#image_generation_insert_type').val(
            extension_settings[extensionName].insertType,
        );
        $('#prompt_injection_enabled').prop(
            'checked',
            extension_settings[extensionName].promptInjection.enabled,
        );
        const activeProfile = getActiveProfile();
        $('#image_generation_profile').val(activeProfile.name);
        $('#prompt_injection_text').val(activeProfile.prompt || '');
        $('#prompt_injection_profile_label').text(profileLabel(activeProfile.name));
        refreshProfileHint();
        refreshTokenInfo();
        $('#prompt_injection_regex').val(
            extension_settings[extensionName].promptInjection.regex,
        );
        $('#prompt_injection_position').val(
            extension_settings[extensionName].promptInjection.position,
        );
        $('#prompt_injection_position').prop('disabled', true);
        $('#prompt_injection_depth').val(
            extension_settings[extensionName].promptInjection.depth,
        );
    }

    if ($('#resolution_presets_table').length) {
        const presets = extension_settings[extensionName].resolutionPresets || defaultSettings.resolutionPresets;
        $('#resolution_presets_table tbody tr').each(function () {
            const type = $(this).data('type');
            if (presets[type]) {
                $(this).find('.preset-width').val(presets[type].width);
                $(this).find('.preset-height').val(presets[type].height);
                updatePixelCount($(this));
            }
        });
        $('#default_image_type').val(
            extension_settings[extensionName].defaultType || 'portrait',
        );
        $('#image_generation_queue_concurrency').val(
            extension_settings[extensionName].queueConcurrency || 1,
        );
        $('#image_generation_delay').val(
            extension_settings[extensionName].generationDelayMs || 0,
        );
        $('#image_generation_skip_streaming').prop(
            'checked',
            Boolean(extension_settings[extensionName].skipStreamingPregeneration),
        );
        $('#image_generation_debug').prop(
            'checked',
            Boolean(extension_settings[extensionName].debug),
        );
        // v1.5 quality + safety fields
        const cfgUi = extension_settings[extensionName] || {};
        // qualityPrefix / qualityPrefixAuto / negativePrompt / sanitizePrompts UI removed —
        // values still apply at defaults; edit in settings JSON if needed.
        $('#image_generation_dedupe').prop('checked', cfgUi.enableDedupe !== false);
        $('#image_generation_vir_drift').prop('checked', Boolean(cfgUi.virDriftWarn));
        try {
            $('#image_generation_lora_triggers').val(JSON.stringify(cfgUi.loraTriggers || {}, null, 2));
        } catch { $('#image_generation_lora_triggers').val('{}'); }
        // Per-chat fields — read from chat_metadata, not from extension_settings.
        // CHAT_CHANGED already triggers updateUI() so the checkbox reloads on chat switch.
        $('#image_generation_chat_disabled').prop('checked', isChatDisabled());
    }
}

// Hint under the profile select: the active chat-completion preset name and
// the VIR extension's profile, with a warning colour when they disagree.
function refreshProfileHint() {
    const el = $('#image_generation_profile_hint');
    if (!el.length) return;
    const name = getProfileName();
    const notes = [];
    let presetName = '';
    try { presetName = String(getContext()?.chatCompletionSettings?.preset_settings_openai || ''); } catch { /* ignore */ }
    if (presetName) {
        notes.push(`Active preset: ${presetName}.`);
        const mine = name === 'anima' ? /anima/i : /krea/i;
        const other = name === 'anima' ? /krea/i : /anima/i;
        if (other.test(presetName) && !mine.test(presetName)) notes.push(`Preset name looks like ${profileLabel(name === 'anima' ? 'krea2' : 'anima')}; profile is ${profileLabel(name)}.`);
    }
    const virProfile = typeof window.ff4VirGetProfile === 'function' ? window.ff4VirGetProfile() : '';
    if (virProfile && virProfile !== name) notes.push(`FF4 VIR is set to ${profileLabel(virProfile)}.`);
    el.text(notes.join(' '));
    el.css('color', notes.length > 1 ? 'var(--warning, #d7a900)' : '');
}

// "Injecting now" readout: the exact string refreshImagePromptInjection sends,
// counted with ST's tokenizer (chars/3.8 if the tokenizer is unavailable).
let tokenInfoTimer = null;
async function refreshTokenInfo() {
    const el = $('#image_generation_token_info');
    if (!el.length) return;
    const cfg = extension_settings[extensionName] || {};
    const prof = getActiveProfile();
    const text = String(prof.prompt || '');
    const injecting = Boolean(cfg.promptInjection?.enabled) && cfg.insertType !== INSERT_TYPE.DISABLED && !isChatDisabled();
    let tokens = 0;
    try { tokens = text ? await getTokenCountAsync(text) : 0; } catch { tokens = Math.round(text.length / 3.8); }
    const depth = Number(cfg.promptInjection?.depth);
    const depthText = Number.isFinite(depth) && depth >= 1 ? depth : 1;
    const why = !cfg.promptInjection?.enabled ? 'prompt injection OFF'
        : cfg.insertType === INSERT_TYPE.DISABLED ? 'insert type Disabled'
        : isChatDisabled() ? 'disabled for this chat' : '';
    el.text(injecting
        ? `Injecting now: ${tokens.toLocaleString()} tokens (${profileLabel(prof.name)} template, in-chat depth ${depthText}, user role).`
        : `Injecting now: 0 tokens (${why}; the ${profileLabel(prof.name)} template would be ${tokens.toLocaleString()} tokens).`);
    el.css('color', injecting ? 'var(--success, #6f6)' : '');
}
function scheduleTokenInfo() {
    clearTimeout(tokenInfoTimer);
    tokenInfoTimer = setTimeout(() => { refreshTokenInfo(); }, 300);
}

// 加载设置
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    let settingsChanged = false;

    // 如果设置为空或缺少必要属性，使用默认设置
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], JSON.parse(JSON.stringify(defaultSettings)));
        settingsChanged = true;
    } else {
        // 确保promptInjection对象存在
        if (!extension_settings[extensionName].promptInjection) {
            extension_settings[extensionName].promptInjection =
                defaultSettings.promptInjection;
            settingsChanged = true;
        } else {
            // 确保promptInjection的所有子属性都存在
            const defaultPromptInjection = defaultSettings.promptInjection;
            for (const key in defaultPromptInjection) {
                if (
                    extension_settings[extensionName].promptInjection[key] ===
                    undefined
                ) {
                    extension_settings[extensionName].promptInjection[key] =
                        defaultPromptInjection[key];
                    settingsChanged = true;
                }
            }
        }

        // 确保insertType属性存在
        if (extension_settings[extensionName].insertType === undefined) {
            extension_settings[extensionName].insertType =
                defaultSettings.insertType;
            settingsChanged = true;
        }
        if (extension_settings[extensionName].promptInjection.position !== 'deep_user') {
            extension_settings[extensionName].promptInjection.position = 'deep_user';
            settingsChanged = true;
        }
        // Migrate depth 0 → 1. depth 0 injected the pic-tag rules at the
        // absolute final slot, AFTER the user's latest message, so the model's
        // highest-recency turn was a wall of formatting rules and the real
        // input was buried — weak models then re-sent their previous reply.
        // depth 1 keeps the rules squash-proof but puts the user input last.
        const curDepth = Number(extension_settings[extensionName].promptInjection.depth);
        if (!Number.isFinite(curDepth) || curDepth < 1) {
            extension_settings[extensionName].promptInjection.depth = 1;
            settingsChanged = true;
        }

        // v9.0 one-time profile migration. The saved single template was the
        // bundled Anima-era default (with mojibake dashes from an old save), so
        // both profiles start from their bundled defaults rather than from it.
        if (extension_settings[extensionName].profilesV1Applied !== true) {
            const cfg = extension_settings[extensionName];
            cfg.profiles = JSON.parse(JSON.stringify(PROFILE_DEFAULTS));
            if (!PROFILE_NAMES.includes(cfg.profile)) cfg.profile = 'krea2';
            if (/^krea_/.test(String(cfg.resolutionProfile || ''))) cfg.profiles.krea2.resolutionProfile = cfg.resolutionProfile;
            mirrorActivePrompt(cfg);
            cfg.profilesV1Applied = true;
            settingsChanged = true;
            console.log(`[${extensionName}] Applied v9.0 image profiles: profile=${cfg.profile}, templates reset to the bundled Anima/Krea2 defaults.`);
        }
        if (ensureProfiles(extension_settings[extensionName])) settingsChanged = true;

        // Auto-migrate previous bundled prompt contracts to the current
        // strengthened anchor-based version. This updates installs that still
        // have an older default prompt saved in settings.json. Each profile's
        // template is checked on its own; the active one is mirrored into
        // promptInjection.prompt afterwards.
        for (const profileName of PROFILE_NAMES) {
        const currentPrompt = String(
            extension_settings[extensionName].profiles[profileName].prompt || '',
        );
        const verbosePromptMarkers = [
            '[NAME-ONCE / CONTIGUOUS BLOCK / POSITION]',
            'ONE BLOCK PER CHARACTER, left-to-right',
            'Within the pic prompt: did you name each character ONCE only?',
        ];
        const priorPromptMarkers = [
            '[ANIMA PROMPT STYLE]',
            'Write Circle Labs Anima prompts in compact natural language.',
            'Write Circle Labs Anima prompts in clear natural language with rich concrete detail.',
            'ACTIVE VIR is the source for identity anchors.',
            'PIC COPY is the strongest identity source.',
        ];
        // v3.6 ANATOMY + GEOMETRY — fixes two persistent drift bugs:
        //   1. anatomy omission (futa without penis, alien without tentacles)
        //      via mandatory ANATOMY DISCLOSURE per-character-block, loophole
        //      ("if visible") removed
        //   2. verb-vs-geometry mismatch (deepthroat scene with penis adjacent
        //      to face) via mandatory ACTION GEOMETRY in Staging — describe
        //      body-part intersections, never just the verb label
        // v1.5 through v3.8 all auto-migrate on next ST load.
        // v3.9 COMPRESSED — same rules/fields/categories as v3.8 but hard-
        // compressed ~7-8k tok → ~1.6-2.1k tok (no SEX-ACT/COMBAT tables; the
        // geometry examples are inline and the model generalizes). The unique
        // sentinel "generalize the same way for any act" exists ONLY in the
        // compressed prompt, so every older verbose prompt (which lacks it)
        // re-syncs once, and the compressed prompt does not loop.
        // v8.0: sentinel "cadence-v8" lives only in the always-on beat-pic
        // prompt, so saved bundled prompts with the v7 zero-pic loophole
        // re-sync once to the current contract.
        // v5.0: sentinel "cadence-v5" lives only in the beat-cadence+attribution
        // prompt, so every older bundled prompt (verbose, v3.6-v3.9, and v4.0
        // which has cadence-v4 but not v5) re-syncs once to the current contract.
        const usesOutdatedCurrentBundledPrompt =
            (
                currentPrompt.includes('[OVERRIDE PRECEDENCE - highest priority for this reply]')
                || currentPrompt.includes('[REASONING OVERRIDE')
            )
            && !currentPrompt.includes('cadence-v8');
        const usesLegacyVerbosePrompt = verbosePromptMarkers.every((marker) =>
            currentPrompt.includes(marker),
        );
        const usesOlderBundledPrompt = priorPromptMarkers.some((marker) =>
            currentPrompt.includes(marker),
        ) && !currentPrompt.includes('[OVERRIDE PRECEDENCE - highest priority for this reply]');
        if (usesLegacyVerbosePrompt || usesOlderBundledPrompt || usesOutdatedCurrentBundledPrompt) {
            extension_settings[extensionName].profiles[profileName].prompt =
                PROFILE_DEFAULT_PROMPTS[profileName];
            settingsChanged = true;
            console.log(
                `[${extensionName}] Auto-migrated older bundled ${profileLabel(profileName)} prompt to the current VIR-driven contract.`,
            );
        }
        }
        mirrorActivePrompt(extension_settings[extensionName]);

        // Auto-migrate broken/legacy pic-tag regexes to the current quote-aware default.
        // The OLD default used [^"']* which truncated prompts at the first apostrophe
        // ("ETSVin's shirt" → "ETSVin"). Any user still on that pattern should be upgraded.
        const legacyPicRegexes = [
            '/<pic[^>]*\\sprompt=[\'"]([\\s\\S]*?)[\'"]\\s*>/g',
            '/<pic[^>]*\\sprompt=[\'"]([\\s\\S]*?)[\'"]\\s*\\/?>/g',
            // Old broken default (truncated at apostrophe):
            '/<pic\\b(?=[^>]*\\sprompt=["\'][^"\']*["\'])[^>]*\\sprompt=["\']([^"\']*)["\'][^>]*\\/?>/g',
            // Case-SENSITIVE quote-aware default (missed <Pic ...> when the model
            // capitalized the tag). Upgrade to the /gi version.
            '/<pic\\b[^>]*\\sprompt=(?:"([^"]*)"|\'([^\']*)\')[^>]*\\/?>/g',
            // Quote-aware /gi default that still used [^"]*/[^']* — truncated the
            // value at the first embedded quote (a height like 5'3" dropped the
            // rest of the prompt). Upgrade to the lookahead-delimited version.
            '/<pic\\b[^>]*\\sprompt=(?:"([^"]*)"|\'([^\']*)\')[^>]*\\/?>/gi',
            // Lookahead-delimited <pic>-only version. Upgrade so <image ...>
            // tags emitted by weaker/smaller models still render.
            '/<pic\\b[^>]*?\\sprompt=(?:"([^>]*?)"|\'([^>]*?)\')(?=\\s*(?:[\\w-]+\\s*=|\\/?>))[^>]*\\/?>/gi',
            // <pic>/<image> only version. Upgrade so malformed type-first tags
            // like <closeup pic prompt="..."> still render.
            '/<(?:pic|image)\\b[^>]*?\\sprompt=(?:"([^>]*?)"|\'([^>]*?)\')(?=\\s*(?:[\\w-]+\\s*=|\\/?>))[^>]*\\/?>/gi',
            // Normal-quote alias/type-first parser. Upgrade so literal
            // backslash-escaped attributes (prompt=\"...\") also render.
            '/<(?:(?:pic|image)|(?:(?:portrait|landscape|closeup|scene|square)(?=[^>]*\\b(?:pic|image)\\b)))\\b[^>]*?\\sprompt=(?:"([^>]*?)"|\'([^>]*?)\')(?=\\s*(?:[\\w-]+\\s*=|\\/?>))[^>]*\\/?>/gi',
        ];
        if (legacyPicRegexes.includes(extension_settings[extensionName].promptInjection.regex)) {
            extension_settings[extensionName].promptInjection.regex = defaultSettings.promptInjection.regex;
            settingsChanged = true;
            console.log('[' + extensionName + '] Auto-migrated legacy pic-tag regex to quote-aware version (fixes apostrophe + embedded-quote truncation).');
        }

        // Migrate: add resolutionPresets if missing
        if (!extension_settings[extensionName].resolutionPresets) {
            extension_settings[extensionName].resolutionPresets =
                JSON.parse(JSON.stringify(defaultSettings.resolutionPresets));
            settingsChanged = true;
        } else {
            // Ensure all default types are present
            for (const type in defaultSettings.resolutionPresets) {
                if (!extension_settings[extensionName].resolutionPresets[type]) {
                    extension_settings[extensionName].resolutionPresets[type] =
                        { ...defaultSettings.resolutionPresets[type] };
                    settingsChanged = true;
                }
            }
        }

        // Migrate: add defaultType if missing
        if (extension_settings[extensionName].defaultType === undefined) {
            extension_settings[extensionName].defaultType = defaultSettings.defaultType;
            settingsChanged = true;
        }
        // One-time: a tag without a type used to render square; people-first
        // chats want the portrait frame instead.
        if (extension_settings[extensionName].defaultTypeV2Applied !== true) {
            if (extension_settings[extensionName].defaultType === 'square') extension_settings[extensionName].defaultType = 'portrait';
            extension_settings[extensionName].defaultTypeV2Applied = true;
            settingsChanged = true;
        }

        // v6.0 one-time cadence migration: v4.0 had forced fallback insertion ON
        // (mechanical pic padding), which over-produced pics regardless of the
        // real beat count. Turn it OFF once so the AI alone decides the count via
        // the one-pic-per-beat prompt; the user can re-enable it in settings.
        if (extension_settings[extensionName].cadenceV6Applied !== true) {
            extension_settings[extensionName].allowFallbackTagInsertion = false;
            if (extension_settings[extensionName].maxPicsPerMessage === undefined) {
                extension_settings[extensionName].maxPicsPerMessage = 5;
            }
            extension_settings[extensionName].cadenceV6Applied = true;
            settingsChanged = true;
            console.log(`[${extensionName}] Applied v6.0 beat-exact cadence: fallback insertion OFF (AI counts beats).`);
        }

        // Krea2 one-time prefix migration. The Anima-era quality prefix
        // ("@xlvxp, masterpiece, very aesthetic") is unreadable to the Krea2
        // encoder, and the core Image Generation prefix forced portrait/macro
        // framing onto every shot. Fixed here, on load, rather than only in
        // settings.json: generation runs from the tab's in-memory settings, and
        // an already-open tab autosaves its stale copy back over any file edit.
        // A stale tab's save also drops this flag, so the next load re-applies.
        if (extension_settings[extensionName].krea2PrefixApplied !== true) {
            extension_settings[extensionName].qualityPrefix = '';
            extension_settings[extensionName].qualityPrefixAuto = false;

            const FRAMING = new Set(['intimate portrait photography', 'macro lens', 'shallow depth of field']);
            const fixPrefix = (prefix) => {
                const text = String(prefix || '');
                if (!text.includes('{prompt}')) return text;
                const parts = text.split(/,|\{prompt\}/).map(s => s.trim()).filter(Boolean);
                if (!parts.some(p => FRAMING.has(p.toLowerCase()))) return text;
                const style = parts.filter(p => !FRAMING.has(p.toLowerCase()));
                if (!style.length) return '{prompt}';
                const joined = style.join(', ');
                // Style after {prompt}: the pic's own head line (rating, counts,
                // act, camera, place) must lead, where the encoder reads hardest.
                return `{prompt} ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
            };

            const sd = extension_settings.sd;
            if (sd) {
                sd.prompt_prefix = fixPrefix(sd.prompt_prefix);
                for (const style of Array.isArray(sd.styles) ? sd.styles : []) {
                    style.prefix = fixPrefix(style.prefix);
                }
                // Core SD fills this textarea from settings at its own init; keep
                // it in step so a later edit there cannot re-save the old text.
                const box = document.getElementById('sd_prompt_prefix');
                if (box) box.value = sd.prompt_prefix;
            }

            extension_settings[extensionName].krea2PrefixApplied = true;
            settingsChanged = true;
            console.log(`[${extensionName}] Applied Krea2 prefix migration: quality prefix off, portrait framing removed.`);
        }

        for (const key of [
            'profile',
            'queueConcurrency', 'generationDelayMs', 'skipStreamingPregeneration', 'debug', 'resolutionProfile',
            'negativePrompt', 'qualityPrefix', 'qualityPrefixAuto', 'sanitizePrompts', 'virDriftWarn', 'enableDedupe', 'allowFallbackTagInsertion', 'fallbackOnlyWhenZero', 'maxPicsPerMessage', 'loraTriggers', 'lastPicAudit',
        ]) {
            if (extension_settings[extensionName][key] === undefined) {
                const def = defaultSettings[key];
                extension_settings[extensionName][key] = (def && typeof def === 'object') ? JSON.parse(JSON.stringify(def)) : def;
                settingsChanged = true;
            }
        }
    }

    if (settingsChanged) {
        saveSettingsDebounced();
    }

    updateUI();
}

// 创建设置页面
async function createSettings(settingsHtml) {
    // 创建一个容器来存放设置，确保其正确显示在扩展设置面板中
    if (!$('#image_auto_generation_container').length) {
        $('#extensions_settings2').append(
            '<div id="image_auto_generation_container" class="extension_container"></div>',
        );
    }

    // 使用传入的settingsHtml而不是重新获取
    $('#image_auto_generation_container').empty().append(settingsHtml);

    // 添加设置变更事件处理
    $('#image_generation_insert_type').on('change', function () {
        const newValue = $(this).val();
        extension_settings[extensionName].insertType = newValue;
        updateUI();
        saveSettingsDebounced();
    });

    // 添加提示词注入设置的事件处理
    $('#prompt_injection_enabled').on('change', function () {
        extension_settings[extensionName].promptInjection.enabled =
            $(this).prop('checked');
        saveSettingsDebounced();
        refreshImagePromptInjection();
        refreshTokenInfo();
    });

    // Image profile select: switches the template, look row, no-text closer,
    // prompt cap and this profile's remembered resolution preset.
    $('#image_generation_profile').on('change', function () {
        const cfg = extension_settings[extensionName];
        const name = PROFILE_NAMES.includes($(this).val()) ? $(this).val() : 'krea2';
        cfg.profile = name;
        ensureProfiles(cfg);
        mirrorActivePrompt(cfg);
        const resName = cfg.profiles[name].resolutionProfile;
        if (RESOLUTION_PROFILES[resName]) {
            cfg.resolutionPresets = JSON.parse(JSON.stringify(RESOLUTION_PROFILES[resName]));
            cfg.resolutionProfile = resName;
        }
        updateUI();
        saveSettingsDebounced();
        refreshImagePromptInjection();
        toastr.info(`Image profile: ${profileLabel(name)}${RESOLUTION_PROFILES[resName] ? ` (resolution ${resName.replace(/_/g, ' ')})` : ''}.`);
    });

    $('#prompt_injection_text').on('input', function () {
        const cfg = extension_settings[extensionName];
        ensureProfiles(cfg);
        cfg.profiles[getProfileName()].prompt = $(this).val();
        mirrorActivePrompt(cfg);
        saveSettingsDebounced();
        refreshImagePromptInjection();
        scheduleTokenInfo();
    });

    $('#prompt_injection_regex').on('input', function () {
        extension_settings[extensionName].promptInjection.regex = $(this).val();
        saveSettingsDebounced();
    });

    $('#prompt_injection_position').on('change', function () {
        extension_settings[extensionName].promptInjection.position =
            $(this).val();
        saveSettingsDebounced();
    });

    // 深度设置事件处理
    $('#prompt_injection_depth').on('input', function () {
        const value = parseInt(String($(this).val()));
        extension_settings[extensionName].promptInjection.depth = isNaN(value)
            ? 0
            : value;
        saveSettingsDebounced();
    });

    // Default image type handler
    $('#default_image_type').on('change', function () {
        extension_settings[extensionName].defaultType = $(this).val();
        saveSettingsDebounced();
    });

    // Resolution preset table handlers
    $('#resolution_presets_table').on('input', '.preset-width, .preset-height', function () {
        const row = $(this).closest('tr');
        const type = row.data('type');
        const width = parseInt(row.find('.preset-width').val()) || 512;
        const height = parseInt(row.find('.preset-height').val()) || 512;
        if (!extension_settings[extensionName].resolutionPresets) {
            extension_settings[extensionName].resolutionPresets = {};
        }
        extension_settings[extensionName].resolutionPresets[type] = { width, height };
        updatePixelCount(row);
        saveSettingsDebounced();
    });

    $('#image_generation_queue_concurrency').on('input', function () {
        const value = Math.max(1, Math.min(4, parseInt(String($(this).val())) || 1));
        extension_settings[extensionName].queueConcurrency = value;
        $(this).val(value);
        saveSettingsDebounced();
    });

    $('#image_generation_delay').on('input', function () {
        const value = Math.max(0, Math.min(30000, parseInt(String($(this).val())) || 0));
        extension_settings[extensionName].generationDelayMs = value;
        $(this).val(value);
        saveSettingsDebounced();
    });

    $('#image_generation_skip_streaming').on('change', function () {
        extension_settings[extensionName].skipStreamingPregeneration = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#image_generation_debug').on('change', function () {
        extension_settings[extensionName].debug = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // ── Per-chat disable handler ────────────────────────────────────────────
    $('#image_generation_chat_disabled').on('change', function () {
        const checked = $(this).prop('checked');
        setChatDisabled(checked);
        // Re-evaluate injection state immediately so the rule blob is cleared/restored without
        // waiting for the next CHAT_CHANGED. Other chats are not touched.
        try { refreshImagePromptInjection(); refreshTokenInfo(); } catch { /* ignore */ }
        toastr[checked ? 'warning' : 'info'](checked
            ? 'Image auto-generation DISABLED for this chat (pic injection + auto gen skipped).'
            : 'Image auto-generation re-enabled for this chat.');
    });

    // qualityPrefix / qualityPrefixAuto / negativePrompt / sanitizePrompts handlers removed —
    // those settings keep their stored values (or defaults), they're just no longer user-tunable from the panel.
    $('#image_generation_dedupe').on('change', function () {
        extension_settings[extensionName].enableDedupe = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#image_generation_vir_drift').on('change', function () {
        extension_settings[extensionName].virDriftWarn = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#image_generation_lora_triggers').on('change blur', function () {
        const raw = String($(this).val() || '').trim();
        if (!raw) {
            extension_settings[extensionName].loraTriggers = {};
            saveSettingsDebounced();
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Must be a JSON object: { "Name": "trigger" }');
            }
            extension_settings[extensionName].loraTriggers = parsed;
            saveSettingsDebounced();
            toastr.success(`LoRA triggers saved (${Object.keys(parsed).length} entr${Object.keys(parsed).length === 1 ? 'y' : 'ies'}).`);
        } catch (err) {
            toastr.error(`LoRA triggers JSON error: ${err.message || err}`);
        }
    });

    $('#image_generation_reset_regex').on('click', function () {
        extension_settings[extensionName].promptInjection.regex = defaultSettings.promptInjection.regex;
        $('#prompt_injection_regex').val(defaultSettings.promptInjection.regex);
        saveSettingsDebounced();
        toastr.info('Image tag regex reset to default.');
    });

    $('#image_generation_reset_prompt').on('click', function () {
        const cfg = extension_settings[extensionName];
        ensureProfiles(cfg);
        const name = getProfileName();
        cfg.profiles[name].prompt = PROFILE_DEFAULT_PROMPTS[name];
        mirrorActivePrompt(cfg);
        $('#prompt_injection_text').val(cfg.profiles[name].prompt);
        saveSettingsDebounced();
        refreshImagePromptInjection();
        refreshTokenInfo();
        toastr.info(`${profileLabel(name)} prompt template reset to default.`);
    });

    $('#image_generation_test_regex').on('click', function () {
        try {
            const regex = regexFromString(extension_settings[extensionName].promptInjection.regex);
            // Sample embeds a height (5'3") inside the double-quoted value so the
            // test fails loudly if the regex truncates at an interior quote.
            const sample = `Narration before. <pic prompt="masterpiece, a woman 5'3" tall, red cloak" type="portrait"> Narration after.`;
            const matches = regex.global ? [...sample.matchAll(regex)] : (sample.match(regex) ? [sample.match(regex)] : []);
            const m0 = matches?.[0];
            const prompt = extractPromptFromPicMatch(m0);
            if (prompt && /red cloak/.test(prompt)) {
                toastr.success(`Regex works (kept the full value past 5'3"). Captured prompt: ${prompt}`);
            } else if (prompt) {
                toastr.warning(`Regex truncated at an embedded quote — captured only: ${prompt}`);
            } else {
                toastr.warning('Regex did not capture a prompt. One prompt capture group must contain the value.');
            }
        } catch (error) {
            toastr.error(`Regex error: ${error}`);
        }
    });

    $('.image-generation-resolution-profile').on('click', function () {
        const profileName = $(this).data('profile');
        const profile = RESOLUTION_PROFILES[profileName];
        if (!profile) return;
        extension_settings[extensionName].resolutionPresets = JSON.parse(JSON.stringify(profile));
        extension_settings[extensionName].resolutionProfile = profileName;
        // Remembered per image profile, so switching profiles restores it.
        ensureProfiles(extension_settings[extensionName]);
        extension_settings[extensionName].profiles[getProfileName()].resolutionProfile = profileName;
        updateUI();
        saveSettingsDebounced();
        toastr.info(`Resolution profile applied: ${profileName.replace('_', ' ')}`);
    });

    // 初始化设置值
    updateUI();
}

// 设置变更处理函数
function onExtensionButtonClick() {
    // 直接访问扩展设置面板
    const extensionsDrawer = $('#extensions-settings-button .drawer-toggle');

    // 如果抽屉是关闭的，点击打开它
    if ($('#rm_extensions_block').hasClass('closedDrawer')) {
        extensionsDrawer.trigger('click');
    }

    // 等待抽屉打开后滚动到我们的设置容器
    setTimeout(() => {
        // 找到我们的设置容器
        const container = $('#image_auto_generation_container');
        if (container.length) {
            // 滚动到设置面板位置
            $('#rm_extensions_block').animate(
                {
                    scrollTop:
                        container.offset().top -
                        $('#rm_extensions_block').offset().top +
                        $('#rm_extensions_block').scrollTop(),
                },
                500,
            );

            // 使用SillyTavern原生的抽屉展开方式
            // 检查抽屉内容是否可见
            const drawerContent = container.find('.inline-drawer-content');
            const drawerHeader = container.find('.inline-drawer-header');

            // 只有当内容被隐藏时才触发展开
            if (drawerContent.is(':hidden') && drawerHeader.length) {
                // 直接使用原生点击事件触发，而不做任何内部处理
                drawerHeader.trigger('click');
            }
        }
    }, 500);
}

// 初始化扩展
$(function () {
    (async function () {
        // 获取设置HTML (只获取一次)
        const settingsHtml = await $.get(
            `${extensionFolderPath}/settings.html`,
        );

        // 添加扩展到菜单
        $('#extensionsMenu')
            .append(`<div id="auto_generation" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-robot"></div>
            <span data-i18n="Image Auto Generation">Image Auto Generation</span>
        </div>`);

        // 修改点击事件，打开设置面板而不是切换状态
        $('#auto_generation').off('click').on('click', onExtensionButtonClick);

        await loadSettings();

        // 创建设置 - 将获取的HTML传递给createSettings
        await createSettings(settingsHtml);

        // 确保设置面板可见时，设置值是正确的
        $('#extensions-settings-button').on('click', function () {
            setTimeout(() => {
                updateUI();
            }, 200);
        });
    })();
});
// 获取消息角色
function getMesRole() {
    // 确保对象路径存在
    if (
        !extension_settings[extensionName] ||
        !extension_settings[extensionName].promptInjection ||
        !extension_settings[extensionName].promptInjection.position
    ) {
        return 'system'; // 默认返回system角色
    }

    switch (extension_settings[extensionName].promptInjection.position) {
        case 'deep_system':
            return 'system';
        case 'deep_user':
            return 'user';
        case 'deep_assistant':
            return 'assistant';
        default:
            return 'system';
    }
}

// Inject the FULL pic-tag contract as a deep in-chat prompt, one slot BEFORE
// the user's latest message (depth 1).
// IMPORTANT: we inject with the 'user' role, NOT 'system'. Many presets enable
// squash_system_messages, which merges every system-role injection into one
// blob and reorders it — that buries this injection near the top of the prompt.
// A 'user'-role message is never squashed, so it stays at deep recency.
// We use depth 1 (not 0): at depth 0 the rules wall sat AFTER the user's real
// input, making weak models ignore the input and re-send their previous reply.
// depth 1 keeps the rules at high recency while leaving the user input last.
const IMAGE_PROMPT_KEY = 'ST_IMAGE_AUTO_GEN';
const IMAGE_PROMPT_POSITION = extension_prompt_types.IN_CHAT;
const LEGACY_PIC_PRIORITY_KEY = 'ST_IMAGE_PIC_PRIORITY';
function refreshImagePromptInjection() {
    try {
        const ctx = getContext();
        const setExtPrompt = ctx?.setExtensionPrompt || window.setExtensionPrompt;
        if (typeof setExtPrompt !== 'function') return;
        const cfg = extension_settings[extensionName];
        const disabled =
            !cfg ||
            !cfg.promptInjection ||
            !cfg.promptInjection.enabled ||
            cfg.insertType === INSERT_TYPE.DISABLED ||
            isChatDisabled();
        const userDepth = Number(cfg?.promptInjection?.depth);
        // Floor at depth 1 so the user's latest message always stays last.
        const depth = Number.isFinite(userDepth) && userDepth >= 1 ? userDepth : 1;
        if (disabled) {
            setExtPrompt(IMAGE_PROMPT_KEY, '', IMAGE_PROMPT_POSITION, depth);
            setExtPrompt(LEGACY_PIC_PRIORITY_KEY, '', IMAGE_PROMPT_POSITION, 0);
            return;
        }
        const prompt = getActiveProfile().prompt || cfg.promptInjection.prompt || '';
        // Force 'user' role so squash_system_messages can't merge-and-bury it.
        const role = extension_prompt_roles.USER;
        // Clear the retired reminder slot in case an earlier session injected it.
        setExtPrompt(LEGACY_PIC_PRIORITY_KEY, '', IMAGE_PROMPT_POSITION, 0);
        setExtPrompt(IMAGE_PROMPT_KEY, prompt, IMAGE_PROMPT_POSITION, depth, false, role);
        debugLog(`[${extensionName}] prompt injected IN_CHAT depth ${depth}, role=${role} (squash-proof)`);
    } catch (err) {
        console.error(`[${extensionName}] failed to register prompt`, err);
    }
}
function getMissCounter() {
    const cfg = extension_settings[extensionName] || {};
    if (typeof cfg.consecutivePicMisses !== 'number') cfg.consecutivePicMisses = 0;
    if (typeof cfg.totalPicMisses !== 'number') cfg.totalPicMisses = 0;
    return cfg;
}

// Hook GENERATION_ENDED to count misses (substantive reply with no pic tag = miss).
// Reset on any reply that successfully emitted a pic tag.
eventSource.on(event_types.GENERATION_ENDED, () => {
    try {
        const ctx = getContext();
        const last = ctx?.chat?.[ctx.chat.length - 1];
        if (!last || last.is_user || last.is_system) return;
        const cfg = getMissCounter();
        const mes = String(last.mes || '');
        const reasoning = String(last.extra?.reasoning || '');
        // Look for evidence the AI emitted a pic this turn (in visible reply OR
        // the auto-gen extension stored its prompt). Avoid counting markdown
        // image markers from earlier turns or character backgrounds.
        const hadInlinePrompt = !!(last.extra?.inlineImagePrompts && Object.keys(last.extra.inlineImagePrompts).length);
        const visiblePicTag = /<(?:(?:pic|image)|(?:(?:portrait|landscape|closeup|scene|square)(?=[^>]*\b(?:pic|image)\b)))\b[^>]*prompt=/i.test(mes);
        const visibleImageMd = /!\[generated image\]/i.test(mes);
        const reasoningPicOnly = !visiblePicTag && !visibleImageMd && /<(?:(?:pic|image)|(?:(?:portrait|landscape|closeup|scene|square)(?=[^>]*\b(?:pic|image)\b)))\b/i.test(reasoning);

        const wordCount = mes.trim().split(/\s+/).length;
        const looksSubstantive = wordCount >= 60;

        if (hadInlinePrompt || visiblePicTag || visibleImageMd) {
            if ((cfg.consecutivePicMisses||0) > 0) {
                debugLog(`[${extensionName}] pic emitted — resetting miss counter (was ${cfg.consecutivePicMisses})`);
            }
            cfg.consecutivePicMisses = 0;
        } else if (reasoningPicOnly) {
            // Leak into reasoning — count as miss AND log clearly
            cfg.consecutivePicMisses = (cfg.consecutivePicMisses || 0) + 1;
            cfg.totalPicMisses = (cfg.totalPicMisses || 0) + 1;
            console.warn(`[${extensionName}] PIC LEAK — tag was in reasoning, NOT visible reply (miss #${cfg.consecutivePicMisses})`);
        } else if (looksSubstantive) {
            cfg.consecutivePicMisses = (cfg.consecutivePicMisses || 0) + 1;
            cfg.totalPicMisses = (cfg.totalPicMisses || 0) + 1;
            console.warn(`[${extensionName}] pic miss #${cfg.consecutivePicMisses} (total ${cfg.totalPicMisses})`);
        }
        const ctx2 = getContext();
        ctx2?.saveSettingsDebounced?.();
    } catch(e) { console.warn(`[${extensionName}] miss tracking failed`, e); }
});

// Initial registration + refresh hooks. The Prompt Manager reads its
// collection at generation time, so we only need to keep our entry up to date.
eventSource.on(event_types.APP_READY, () => { refreshImagePromptInjection(); });
eventSource.on(event_types.CHAT_CHANGED, () => { refreshImagePromptInjection(); });
eventSource.on(event_types.SETTINGS_UPDATED, () => { refreshImagePromptInjection(); });
window.stImageAutoGenTracker = window.stImageAutoGenTracker || new Map();
window.stImageAutoGenStatuses = window.stImageAutoGenStatuses || new Map();
// Public API — exposed for sibling extensions (e.g. st-inline-image-viewer)
// so the rerender path can apply the same prompt sanitization
// (sanitizeForAnimaQwen / ensureQualityPrefix / applyLoraTriggers /
// normalizePromptPeopleCount + character SD prefix) that auto-image-gen
// itself uses. Without this, the rerender feeds the raw stored prompt to
// ComfyUI which can fail silently ("no recognizable outputs") on workflows
// that require the quality prefix or whose text encoder mis-handles
// people-count mismatches.
window.stImageAutoGenBuildEffectivePrompt = buildEffectivePrompt;
window.stImageAutoGenGetCharacterSDPrefix = getCharacterSDPrefix;
window.stImageAutoGenGetProfile = getProfileName;
window.stImageAutoGenLockLookSentences = lockLookSentences;
// Sequential generation queue — prevents flooding ComfyUI with parallel requests
// which causes model unload/reload thrashing
window.stImageGenQueue = window.stImageGenQueue || [];
window.stImageGenRunning = window.stImageGenRunning || false;

function makeImageJobKey(messageId, picIndex, prompt, imageType) {
    // When dedupe is on, two pic tags with the same normalized prompt+type in the
    // same message share a key → tracker.get() returns the same promise → one /sd
    // call, two embeds. When off, each pic gets a unique key by picIndex.
    const dedupe = extension_settings[extensionName]?.enableDedupe !== false;
    const typePart = imageType || 'default';
    const normalized = normalizePromptKey(prompt);
    return dedupe
        ? `${messageId}:${typePart}:${normalized}`
        : `${messageId}:${picIndex}:${typePart}:${normalized}`;
}

function setImageJobStatus(key, status) {
    window.stImageAutoGenStatuses.set(key, { status, updatedAt: Date.now() });
    debugLog('image job status', key, status);
}

async function processImageQueue() {
    const maxRunning = Math.max(1, Math.min(4, parseInt(extension_settings[extensionName]?.queueConcurrency) || 1));
    if (window.stImageGenRunning >= maxRunning || window.stImageGenQueue.length === 0) return;

    while (window.stImageGenRunning < maxRunning && window.stImageGenQueue.length > 0) {
        const job = window.stImageGenQueue.shift();
        window.stImageGenRunning++;
        runQueuedGeneration(job).finally(() => {
            window.stImageGenRunning = Math.max(0, window.stImageGenRunning - 1);
            processImageQueue();
        });
    }
}

async function runQueuedGeneration({ key, prompt, insertType, imageType, resolvePromise, rejectPromise }) {
    try {
        setImageJobStatus(key, 'generating');
        const command = getGenerationCommand();
        if (!command) {
            toastr.warning('Image generation is not configured. Enable SillyTavern Image Generation and confirm /sd or /imagine works.');
            throw new Error('No image generation slash command is available');
        }
        const dims = resolveResolution(imageType);
        const effectivePrompt = buildEffectivePrompt(await lockIdentityLook(prompt));
        // Optional VIR drift warning (fire-and-forget, doesn't block the gen)
        warnVirDrift(effectivePrompt);
        const cfg = extension_settings[extensionName] || {};
        const negative = String(cfg.negativePrompt || '').trim();
        const cmdArgs = {
            quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true',
            processing: 'minimal',
            extend: 'false',
            width: String(dims.width),
            height: String(dims.height),
        };
        if (negative) cmdArgs.negative = negative;
        debugLog('runQueuedGeneration', { key, dims, hasNegative: !!negative, effectiveLen: effectivePrompt.length });
        const promise = command.callback(cmdArgs, effectivePrompt);
        const imageUrl = await promise;
        setImageJobStatus(key, imageUrl ? 'done' : 'failed');
        resolvePromise?.(imageUrl || null);
    } catch (err) {
        setImageJobStatus(key, 'failed');
        resolvePromise?.(null);
        console.error(`[${extensionName}] Queue generation error:`, err);
    }
}

function clearPendingQueue() {
    for (const item of window.stImageGenQueue.splice(0)) {
        setImageJobStatus(item.key, 'skipped');
        item.resolvePromise?.(null);
    }
}

eventSource.on(event_types.MESSAGE_SWIPED, clearPendingQueue);
eventSource.on(event_types.CHAT_CHANGED, clearPendingQueue);
// Refresh extension UI when switching chats.
eventSource.on(event_types.CHAT_CHANGED, () => { try { updateUI(); } catch { /* ignore */ } });

function collectValidPicMatches(matches) {
    return (matches || [])
        .map((match, originalIndex) => {
            const originalTag = typeof match?.[0] === 'string' ? match[0] : '';
            const prompt = extractPromptFromPicMatch(match);
            return { match, originalIndex, originalTag, prompt };
        })
        .filter(item => item.originalTag && normalizePromptKey(item.prompt));
}

// ── Pic-tag rescue from reasoning blocks ────────────────────────────────────
// Thinking models (Kimi, DeepSeek, etc.) compose the <pic> tag mid-reasoning
// and often leave it INSIDE the <think>...</think> block. The old code stripped
// <think> before scanning for pics, so any pic placed in reasoning was deleted
// with it — that is the "pics work, then vanish for a few turns, then come
// back" intermittency: it is a coin-flip per generation on where the model
// puts the tag.
//
// Fix: hoist every <pic ...> tag OUT of <think> blocks and into visible prose
// (right after the block) before extraction. The pic then generates AND is
// visible, regardless of where the model placed it. The rest of the reasoning
// stays in <think> and is display-stripped normally.
const BEAT_VISUAL_HINTS = [
    'look', 'glance', 'gaze', 'smile', 'grin', 'blush', 'stare', 'expression',
    'stand', 'standing', 'sit', 'sitting', 'kneel', 'kneeling', 'lean', 'turn',
    'step', 'walk', 'enter', 'leave', 'reach', 'lift', 'pin', 'pull', 'push',
    'grab', 'hold', 'press', 'touch', 'kiss', 'hug', 'embrace', 'straddle',
    'undress', 'dress', 'robe', 'shirt', 'skirt', 'stockings', 'heels', 'bra',
    'panties', 'bed', 'chair', 'door', 'mirror', 'window', 'room', 'light',
    'thrust', 'ride', 'lap', 'cuddle', 'moan', 'pant', 'nipples', 'breasts',
    'cock', 'pussy', 'anal', 'oral', 'cum', 'nude', 'topless',
];
const CLOSEUP_HINTS = ['face', 'cheek', 'eyes', 'lips', 'kiss', 'whisper', 'blush', 'close', 'chin', 'breath'];
const LANDSCAPE_HINTS = ['hall', 'street', 'forest', 'garden', 'beach', 'city', 'mountain', 'sky', 'wide', 'landscape'];
const SCENE_HINTS = ['together', 'between', 'behind', 'in front of', 'against', 'holding', 'grabbing', 'thrust', 'ride', 'straddle', 'kiss'];
const EXPLICIT_HINTS = ['sex', 'thrust', 'cock', 'pussy', 'anal', 'oral', 'nipple', 'nipples', 'cum', 'penetrat', 'fuck', 'ride'];
const SUGGESTIVE_HINTS = ['nude', 'topless', 'shirtless', 'undress', 'robe', 'lingerie', 'stockings', 'bra', 'panties', 'kiss'];
const LOCATION_HINTS = ['room', 'bedroom', 'living room', 'cottage', 'fire', 'hearth', 'floor', 'rug', 'bed', 'wall', 'window', 'door', 'doorway', 'mirror', 'lake', 'forest', 'street', 'hall', 'garden', 'beach'];
const SPATIAL_HINTS = ['foreground', 'background', 'behind', 'in front of', 'beside', 'near', 'against', 'on his lap', 'on her lap', 'in his lap', 'in her lap', 'facing', 'watching', 'standing', 'kneeling', 'sitting', 'lying', 'straddling', 'curled', 'by the fire', 'at the wall', 'on the floor'];
const BODY_PART_HINTS = ['breasts', 'chest', 'thighs', 'hips', 'ass', 'waist', 'lips', 'mouth', 'cock', 'pussy', 'skin', 'nipples'];

function ensureGlobalRegex(regex) {
    if (!(regex instanceof RegExp)) return /$a/;
    if (regex.global) return regex;
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    return new RegExp(regex.source, flags);
}

function extractPromptFromPicMatch(match) {
    // Groups 1/2 are backslash-escaped double/single quotes; groups 3/4
    // are ordinary double/single quotes. Return the populated branch.
    // Group 5: unterminated value closed by </pic> instead of a quote.
    for (let i = 1; i <= 5; i++) {
        if (typeof match?.[i] === 'string' && match[i].length > 0) {
            return match[i];
        }
    }
    return '';
}

function getImageTagDetectionRegex() {
    // Detection/generation must not depend on prompt injection being enabled.
    // The user's preset can supply pic rules, while this internal parser still
    // catches normal, alias, and type-first tags for rendering.
    return ensureGlobalRegex(regexFromString(defaultSettings.promptInjection.regex));
}

function escapePromptAttributeValue(value) {
    return String(value || '')
        .replace(/\r?\n+/g, ' ')
        .replace(/"/g, '\'')
        .replace(/[<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function maskRanges(text, regexes) {
    let masked = String(text || '');
    for (const regex of regexes) {
        const globalRegex = ensureGlobalRegex(regex);
        masked = masked.replace(globalRegex, (match) => ' '.repeat(match.length));
    }
    return masked;
}

function scoreBeatChunk(text) {
    const lc = String(text || '').toLowerCase();
    let score = 0;
    for (const hint of BEAT_VISUAL_HINTS) {
        if (lc.includes(hint)) score++;
    }
    if (/".+?"/.test(text)) score += 1;
    if (/\*[^*]+\*/.test(text)) score += 1;
    if (text.length > 80) score += 1;
    return score;
}

function collectBeatChunks(text) {
    const chunks = [];
    const chunkRegex = /"[^"\n]+"|\*[^*\n]+\*|[^.!?\n][^.!?\n]*(?:[.!?]+|$)/g;
    for (const match of String(text || '').matchAll(chunkRegex)) {
        const value = String(match[0] || '').trim();
        if (value.length < 10) continue;
        chunks.push({
            text: value,
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            score: scoreBeatChunk(value),
        });
    }
    return chunks;
}

function detectExpectedBeatCount(text) {
    const chunks = collectBeatChunks(text);
    if (!chunks.length) {
        const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
        return words >= 8 ? 1 : 0;
    }
    const strong = chunks.filter((chunk) => chunk.score > 0).length;
    if (strong <= 1) return 1;
    if (strong === 2) return 2;
    return Math.min(5, strong);
}

function chooseBeatChunks(chunks, targetCount) {
    if (!chunks.length || targetCount <= 0) return [];
    const selected = [];
    const beaty = chunks.filter((chunk) => chunk.score > 0);
    for (const chunk of beaty) {
        if (selected.length >= targetCount) break;
        selected.push(chunk);
    }
    if (!selected.length) selected.push(chunks[0]);
    let i = 0;
    while (selected.length < targetCount && i < chunks.length) {
        const chunk = chunks[i++];
        if (!selected.some((picked) => picked.start === chunk.start && picked.end === chunk.end)) {
            selected.push(chunk);
        }
    }
    return selected.sort((a, b) => a.start - b.start);
}

function inferImageTypeFromBeat(text, activeCount) {
    const lc = String(text || '').toLowerCase();
    if (CLOSEUP_HINTS.some((hint) => lc.includes(hint))) return 'closeup';
    if (activeCount > 1 || SCENE_HINTS.some((hint) => lc.includes(hint))) return 'scene';
    if (LANDSCAPE_HINTS.some((hint) => lc.includes(hint))) return 'landscape';
    if (activeCount === 1) return 'portrait';
    return extension_settings[extensionName]?.defaultType || 'square';
}

function inferRatingSentence(...texts) {
    const lc = texts.flat().map((text) => String(text || '')).join(' ').toLowerCase();
    if (EXPLICIT_HINTS.some((hint) => lc.includes(hint))) return 'Explicit adult content showing a sexual act.';
    if (SUGGESTIVE_HINTS.some((hint) => lc.includes(hint))) return 'Suggestive, with some nudity.';
    return 'Safe for work.';
}

function summarizeBeatText(text, maxLen = 220) {
    let value = String(text || '')
        .replace(/<[^>]+>/g, ' ')
        // Markdown and the status header used to survive into the prompt, so
        // the encoder was handed "**Friday | 11:52 PM | Etwin's Bedroom**" and
        // tried to paint that text into the image.
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/^\s*\*\*[^\n*]*\|[^\n*]*\*\*\s*$/gm, ' ')
        .replace(/[*_`#>]+/g, ' ')
        .replace(/\s*\|\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (value.length > maxLen) {
        const cut = value.lastIndexOf(' ', maxLen);
        value = value.slice(0, cut > 80 ? cut : maxLen).trim();
    }
    return value;
}

function splitPromptSentences(text) {
    return String(text || '')
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function isSpatialSentence(text) {
    const lc = String(text || '').toLowerCase();
    return LOCATION_HINTS.some((hint) => lc.includes(hint)) || SPATIAL_HINTS.some((hint) => lc.includes(hint));
}

function isBodyPartOnlySentence(text) {
    const lc = String(text || '').toLowerCase();
    return BODY_PART_HINTS.some((hint) => lc.includes(hint)) && !isSpatialSentence(lc) && !SCENE_HINTS.some((hint) => lc.includes(hint));
}

function buildFallbackContextWindow(chunk, fullText, radius = 260) {
    if (!chunk || typeof chunk.start !== 'number' || typeof chunk.end !== 'number') {
        return summarizeBeatText(fullText, 420);
    }
    const source = String(fullText || '');
    const start = Math.max(0, chunk.start - radius);
    const end = Math.min(source.length, chunk.end + radius);
    return summarizeBeatText(source.slice(start, end), 420);
}

function selectSceneAnchors(contextText) {
    const sentences = splitPromptSentences(contextText);
    const selected = [];
    for (const sentence of sentences) {
        if (selected.length >= 3) break;
        if (isSpatialSentence(sentence) && !selected.includes(sentence)) {
            selected.push(sentence);
        }
    }
    for (const sentence of sentences) {
        if (selected.length >= 3) break;
        if (isBodyPartOnlySentence(sentence) || selected.includes(sentence)) continue;
        selected.push(sentence);
    }
    return selected;
}

// Overlapping slices of the same prose were both reaching the prompt, so the
// same sentence appeared twice. Exact-match dedupe missed it; compare content.
function dedupeOverlapping(sentences) {
    const kept = [];
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    for (const sentence of sentences) {
        const n = norm(sentence);
        if (!n) continue;
        const head = n.slice(0, 40);
        if (kept.some((k) => {
            const kn = norm(k);
            return kn.includes(n) || n.includes(kn) || (head && kn.startsWith(head));
        })) continue;
        kept.push(sentence);
    }
    return kept;
}

function buildActionFocusSentence(contextText, sceneAnchors) {
    const sceneAnchorSet = new Set(sceneAnchors);
    const candidate = splitPromptSentences(contextText)
        .find((sentence) => !sceneAnchorSet.has(sentence) && !isBodyPartOnlySentence(sentence) && scoreBeatChunk(sentence) > 0);
    return candidate || '';
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPicCopyField(picCopy, fieldName) {
    const text = String(picCopy || '');
    if (!text || !fieldName) return '';
    const labels = ['Face', 'Marks', 'Underwear', 'Accessories', 'Equipment', 'Pose', 'Expression', 'Condition'];
    const nextLabels = labels.filter((label) => label !== fieldName).map(escapeRegExp).join('|');
    const re = new RegExp(`${escapeRegExp(fieldName)}:\\s*([\\s\\S]*?)(?=\\s(?:${nextLabels}):|$)`, 'i');
    const match = text.match(re);
    return match?.[1]?.trim().replace(/\s+/g, ' ') || '';
}

function humanizePicCopy(picCopy) {
    let text = String(picCopy || '').trim();
    if (!text) return '';

    const replacements = [
        [/Face:\s*/gi, 'Visible facial features include '],
        [/Marks:\s*/gi, 'Visible marks include '],
        [/Underwear:\s*/gi, 'Their underwear is '],
        [/Accessories:\s*/gi, 'They also wear '],
        [/Equipment:\s*/gi, 'They carry '],
        [/Pose:\s*/gi, 'At this moment, '],
        [/Expression:\s*/gi, 'Their expression is '],
        [/Condition:\s*/gi, 'Their current condition is '],
        [/They wears:\s*/gi, 'They are wearing '],
        [/He wears:\s*/gi, 'He is wearing '],
        [/She wears:\s*/gi, 'She is wearing '],
    ];

    for (const [pattern, replacement] of replacements) {
        text = text.replace(pattern, replacement);
    }

    return text
        .replace(/\s+/g, ' ')
        .replace(/\.\s*\./g, '.')
        .trim();
}

function buildSpatialLayoutSentence(activeEntries, contextText) {
    const contextSentences = splitPromptSentences(contextText).filter((sentence) => isSpatialSentence(sentence));
    if (contextSentences.length) {
        return contextSentences.slice(0, 2).join(' ');
    }

    const descriptors = activeEntries
        .map((entry, index) => {
            const pose = extractPicCopyField(entry?.pic_copy, 'Pose');
            if (!pose) return '';
            const slot = activeEntries.length >= 3
                ? (index === 0 ? 'foreground' : index === activeEntries.length - 1 ? 'background' : 'midground')
                : (index === 0 ? 'foreground' : 'background');
            return `${entry.name} is in the ${slot}, ${pose}.`;
        })
        .filter(Boolean);

    return descriptors.length ? descriptors.join(' ') : '';
}

function pickActivePicCopyEntries(fullText, localText, allCopies) {
    const entries = Object.values(allCopies || {});
    const local = String(localText || '').toLowerCase();
    const full = String(fullText || '').toLowerCase();
    // Prefer characters named in THIS beat's local context, so an auto-inserted
    // pic depicts the actor/speaker of that beat — not whoever else is named
    // elsewhere in the message (which caused wrong-character fallback pics).
    // Prose calls people by first name ("Nico"), while the VIR entry is the
    // canonical one ("Nico Suzune"). Matching only the full name meant the beat's
    // real subject was missed and the pic fell through to the pinned persona.
    const named = (entry, haystack) => {
        const name = String(entry?.name || '').toLowerCase();
        if (!name) return false;
        if (haystack.includes(name)) return true;
        const first = name.split(/\s+/)[0];
        return first.length >= 3 && new RegExp(`\\b${escapeRegExp(first)}\\b`).test(haystack);
    };
    const localNamed = entries.filter((entry) => named(entry, local));
    if (localNamed.length) return localNamed.slice(0, 3);
    // No name in the beat → use a SINGLE message-level subject, not the whole cast.
    const fullNamed = entries.filter((entry) => named(entry, full));
    if (fullNamed.length) return fullNamed.slice(0, 1);
    const tiered = entries
        .filter((entry) => ['PIN', 'ACT'].includes(String(entry?.tier || '').toUpperCase()))
        .slice(0, 1);
    if (tiered.length) return tiered;
    return entries.slice(0, 1);
}

async function buildFallbackTagForBeat(chunk, fullText) {
    const localBeatText = typeof chunk === 'string' ? chunk : chunk?.text || '';
    const allCopies = typeof window.ff4VirGetPicCopies === 'function'
        ? await window.ff4VirGetPicCopies()
        : {};
    // The stored scene gives the rescue pic a room and the live stacking, so it
    // is not generated in a void the way it was before.
    const scene = typeof window.ff4VirGetScene === 'function'
        ? await window.ff4VirGetScene().catch(() => null)
        : null;
    const contextWindow = buildFallbackContextWindow(typeof chunk === 'string' ? null : chunk, fullText);
    // Attribute the inserted pic to the beat's own actor: detect names in the
    // beat plus its immediate context window, not the entire message.
    const activeEntries = pickActivePicCopyEntries(fullText, `${localBeatText} ${contextWindow}`, allCopies);
    const names = activeEntries.map((entry) => entry.name).filter(Boolean);
    const sceneAnchors = selectSceneAnchors(contextWindow);
    const spatialLayout = buildSpatialLayoutSentence(activeEntries, contextWindow);
    const actionFocus = buildActionFocusSentence(contextWindow, sceneAnchors);
    const combinedContext = [contextWindow, ...activeEntries.map((entry) => entry?.pic_copy)].join(' ');
    const imageType = normalizeImageType(inferImageTypeFromBeat(combinedContext, names.length));
    const countSentence = names.length > 0
        ? `${names.length} ${names.length === 1 ? 'person is' : 'people are'} in the picture.`
        : '';
    // Rate from the whole reply, not the ~420-char window: an explicit beat
    // later in the message was being labelled "Safe for work."
    const promptBody = [
        inferRatingSentence(combinedContext, fullText),
        countSentence,
        ...dedupeOverlapping(sceneAnchors),
        spatialLayout,
        'Keep each character\'s clothing, exposure level, underwear, accessories, and equipment exactly as currently described unless this exact visible moment explicitly changes them.',
        'Sexual action alone does not imply nudity or removed clothing for any other character.',
        ...activeEntries.map((entry) => humanizePicCopy(entry?.pic_copy)).filter(Boolean),
        actionFocus,
        // Who is on top, then the room, last: the encoder weights the opening
        // hardest and these are context rather than subject.
        ...names.map((n) => scene?.stacks?.[n]).filter(Boolean).slice(0, 1).map((s) => `${s}.`),
        scene?.setting ? `${scene.setting}.` : '',
    ].filter(Boolean).join(' ');
    const prompt = escapePromptAttributeValue(promptBody);
    return {
        prompt,
        type: imageType,
        tag: `<pic prompt="${prompt}" type="${imageType}">`,
    };
}

function upsertLastPicAudit(patch) {
    const cfg = extension_settings[extensionName] || {};
    const current = cfg.lastPicAudit && typeof cfg.lastPicAudit === 'object'
        ? cfg.lastPicAudit
        : {};
    // Only merge within one message. Merging across messages produced records
    // that contradicted themselves — "fallbackInserted: true" from an earlier
    // message sitting next to "fallbackDisabled: true" from this one — which
    // makes the audit useless for working out what actually happened.
    const sameMessage = patch?.messageId !== undefined && patch.messageId === current.messageId;
    cfg.lastPicAudit = {
        ...(sameMessage ? current : {}),
        ...patch,
        at: new Date().toISOString(),
    };
}

async function ensureInlinePicTags(messageId, message, { allowFallback = true } = {}) {
    const text = String(message?.mes || '');
    const cfg = extension_settings[extensionName] || {};
    if (!text.trim()) return { insertedCount: 0, expectedBeatCount: 0, visibleTagCount: 0, finalText: text };

    const imgTagRegex = getImageTagDetectionRegex();
    const visibleMatches = collectValidPicMatches([...text.matchAll(imgTagRegex)]);
    const maskedText = maskRanges(text, [imgTagRegex, /<details[\s\S]*?<\/details>/gi]);
    const expectedBeatCount = Math.max(1, Math.min(cfg.maxPicsPerMessage || 4, detectExpectedBeatCount(maskedText)));
    const visibleTagCount = visibleMatches.length;

    // Zero-only mode: never pad a reply that already illustrated some beats,
    // only rescue one that illustrated none.
    const zeroOnly = cfg.fallbackOnlyWhenZero !== false;
    const fallbackAllowed = allowFallback
        && cfg.allowFallbackTagInsertion === true
        && (!zeroOnly || visibleTagCount === 0);
    if (!fallbackAllowed) {
        upsertLastPicAudit({
            messageId,
            visibleTagCount,
            expectedBeatCount,
            hoistedFromThink: false,
            fallbackInserted: false,
            insertedCount: 0,
            finalSlotInjection: true,
            fallbackDisabled: true,
            zeroOnlySkip: zeroOnly && visibleTagCount > 0,
            greetingSkip: !allowFallback,
            types: visibleMatches.map(({ originalTag }) => normalizeImageType(extractImageType(originalTag))),
        });
        return { insertedCount: 0, expectedBeatCount, visibleTagCount, finalText: text };
    }

    if (visibleTagCount >= expectedBeatCount) {
        upsertLastPicAudit({
            messageId,
            visibleTagCount,
            expectedBeatCount,
            hoistedFromThink: false,
            fallbackInserted: false,
            insertedCount: 0,
            finalSlotInjection: true,
            types: visibleMatches.map(({ originalTag }) => normalizeImageType(extractImageType(originalTag))),
        });
        return { insertedCount: 0, expectedBeatCount, visibleTagCount, finalText: text };
    }

    const chunks = collectBeatChunks(maskedText);
    // One rescue pic in zero-only mode; the AI keeps deciding the real count.
    const targetBeatCount = zeroOnly ? 1 : Math.max(1, Math.min(cfg.maxPicsPerMessage || 4, expectedBeatCount));
    const chosenChunks = chooseBeatChunks(chunks, targetBeatCount);
    const missingCount = zeroOnly
        ? 1
        : Math.max(0, Math.min((cfg.maxPicsPerMessage || 4) - visibleTagCount, targetBeatCount - visibleTagCount));
    if (!chosenChunks.length || missingCount <= 0) {
        upsertLastPicAudit({
            messageId,
            visibleTagCount,
            expectedBeatCount: targetBeatCount,
            hoistedFromThink: false,
            fallbackInserted: false,
            insertedCount: 0,
            finalSlotInjection: true,
        });
        return { insertedCount: 0, expectedBeatCount: targetBeatCount, visibleTagCount, finalText: text };
    }

    const selectedForInsert = chosenChunks.slice(visibleTagCount, visibleTagCount + missingCount);
    const inserts = [];
    for (const chunk of selectedForInsert) {
        const fallback = await buildFallbackTagForBeat(chunk, maskedText);
        inserts.push({
            index: chunk.end,
            tag: ` ${fallback.tag}`,
            type: fallback.type,
        });
    }

    let finalText = text;
    for (const insert of inserts.sort((a, b) => b.index - a.index)) {
        finalText = finalText.slice(0, insert.index) + insert.tag + finalText.slice(insert.index);
    }

    const missCounter = getMissCounter();
    missCounter.consecutivePicMisses = 0;
    upsertLastPicAudit({
        messageId,
        visibleTagCount,
        expectedBeatCount: targetBeatCount,
        hoistedFromThink: false,
        fallbackInserted: true,
        insertedCount: inserts.length,
        finalSlotInjection: true,
        types: inserts.map((insert) => insert.type),
    });
    return { insertedCount: inserts.length, expectedBeatCount: targetBeatCount, visibleTagCount, finalText };
}

function hoistPicsFromThink(mes) {
    const text = String(mes || '');
    if (!/<think>/i.test(text) && !/<\/think>/i.test(text)) return text;
    const picTag = /<(?:(?:pic|image)|(?:(?:portrait|landscape|closeup|scene|square)(?=[^>]*\b(?:pic|image)\b)))\b[^>]*>/gi;
    // Match a <think> block, OR a dangling reasoning run that ends at </think>
    // with no opening tag (the assistant-prefill case: prefill adds <think>,
    // so the model output starts mid-reasoning and only emits </think>).
    const thinkBlock = /(<think>[\s\S]*?<\/think>)|(^[\s\S]*?<\/think>)/i;
    const m = text.match(thinkBlock);
    if (!m) return text;
    const block = m[0];
    const rescued = block.match(picTag) || [];
    if (rescued.length === 0) return text;
    const blockWithoutPics = block.replace(picTag, '');
    // Re-insert the rescued pic tags immediately after the reasoning block,
    // i.e. at the very start of the visible prose.
    return text.replace(block, blockWithoutPics + '\n' + rescued.join('\n') + '\n');
}

// Streaming-only companion to hoistPicsFromThink: while a <think> block is still
// OPEN (no </think> yet), a thinking model has often already emitted a fully
// formed <pic ...> tag mid-reasoning. hoistPicsFromThink ignores it (it only
// matches CLOSED blocks) and the stream handler then strips the open tail, so
// pre-generation cannot start until </think> closes — which for a reasoning
// model is effectively message-end. This lifts COMPLETE pic tags out of the
// open tail into the visible head so pre-gen fires the moment the tag is whole.
// Partial tags (no closing `>`) don't match, so we never generate from a
// half-written prompt. Only used for streaming pre-gen; the MESSAGE_RECEIVED
// final pass still relies on the closed-block hoist.
function hoistPicsFromOpenThink(mes) {
    const text = String(mes || '');
    const lower = text.toLowerCase();
    const openIdx = lower.lastIndexOf('<think>');
    if (openIdx === -1) return text;
    // If a </think> follows the last <think>, the block is closed — leave it to
    // hoistPicsFromThink.
    if (lower.indexOf('</think>', openIdx) !== -1) return text;
    const head = text.slice(0, openIdx);
    const tail = text.slice(openIdx);
    const picTag = /<(?:(?:pic|image)|(?:(?:portrait|landscape|closeup|scene|square)(?=[^>]*\b(?:pic|image)\b)))\b[^>]*>/gi;
    const rescued = tail.match(picTag) || [];
    if (!rescued.length) return text;
    const tailWithoutPics = tail.replace(picTag, '');
    // Rescued pics go into the VISIBLE head, so the subsequent <think>...$ strip
    // (which removes the open tail) keeps them.
    return `${head}${rescued.join('\n')}\n${tailWithoutPics}`;
}

eventSource.on(event_types.STREAM_TOKEN_RECEIVED, async function () {
    if (!extension_settings[extensionName] || extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED) return;
    if (isChatDisabled()) return;
    if (extension_settings[extensionName].skipStreamingPregeneration) return;
    const context = getContext();
    const msgId = context.chat.length - 1;
    const message = context.chat[msgId];
    if (!message || message.is_user || msgId !== context.chat.length - 1) return;
    const imgTagRegex = getImageTagDetectionRegex();
    let matches;
    // Closed-block hoist first, then rescue complete pics from a still-open
    // <think> tail so pre-gen starts the instant a tag is fully formed.
    const hoistedStreamText = hoistPicsFromOpenThink(hoistPicsFromThink(message.mes));
    // Generate images ONLY from pics that reach the visible OUTPUT — never from a
    // still-OPEN <think> block. A reasoning model may scribble several candidate
    // <pic> prompts while thinking; rendering those would spawn wrong/extra images.
    // So: closed <think>...</think> has its real pics hoisted to visible by
    // hoistPicsFromThink (then the empty block is stripped here), while an open
    // <think>...$ is stripped whole so its in-progress draft pics are ignored.
    // Pre-generation therefore starts once </think> closes and the output streams.
    const cleanTextDesktop = hoistedStreamText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
    if (imgTagRegex.global) { matches = [...cleanTextDesktop.matchAll(imgTagRegex)]; } else { const singleMatch = cleanTextDesktop.match(imgTagRegex); matches = singleMatch ? [singleMatch] : []; }

    const validMatches = collectValidPicMatches(matches);

    if (validMatches.length > 0) {
        const insertType = extension_settings[extensionName].insertType;
        for (const { originalIndex: picIndex, originalTag, prompt } of validMatches) {
            const imageType = normalizeImageType(extractImageType(originalTag));
            const key = makeImageJobKey(msgId, picIndex, prompt, imageType);
            if (window.stImageAutoGenTracker.has(key)) continue;

            let resolvePromise;
            let rejectPromise;
            const generationPromise = new Promise((resolve, reject) => {
                resolvePromise = resolve;
                rejectPromise = reject;
            });
            window.stImageAutoGenTracker.set(key, generationPromise);
            window.stImageGenQueue.push({ key, prompt, insertType, imageType, resolvePromise, rejectPromise });
            setImageJobStatus(key, 'pending');
            processImageQueue(); // Start processing if not already running
        }
    }
});

// 监听消息接收事件负责清理漏网之鱼
eventSource.on(event_types.MESSAGE_RECEIVED, handleIncomingMessage);
window.stImageAutoGenRecovery = window.stImageAutoGenRecovery || new Map();

function scheduleLatestUnrenderedPicRecovery(reason = 'chat') {
    setTimeout(async () => {
        try {
            if (
                !extension_settings[extensionName] ||
                extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED ||
                isChatDisabled()
            ) {
                return;
            }
            const context = getContext();
            const messageId = context.chat.length - 1;
            const message = context.chat[messageId];
            if (!message || message.is_user) return;

            const mes = String(message.mes || '');
            const hasStoredPrompt = !!(message.extra?.inlineImagePrompts && Object.keys(message.extra.inlineImagePrompts).length);
            const hasMarkdownImage = /!\[generated image\]/i.test(mes);
            if (hasStoredPrompt || hasMarkdownImage) return;

            const imgTagRegex = getImageTagDetectionRegex();
            const cleanText = hoistPicsFromThink(mes).replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
            const matches = collectValidPicMatches([...cleanText.matchAll(imgTagRegex)]);
            if (!matches.length) return;

            const recoveryKey = `${messageId}:${message.send_date || ''}:${mes.length}:${matches.length}`;
            const lastTry = window.stImageAutoGenRecovery.get(recoveryKey) || 0;
            if (Date.now() - lastTry < 30000) return;
            window.stImageAutoGenRecovery.set(recoveryKey, Date.now());
            console.info(`[${extensionName}] Recovering ${matches.length} unrendered pic tag(s) in latest message after ${reason}.`);
            await handleIncomingMessage();
        } catch (error) {
            console.warn(`[${extensionName}] Latest unrendered pic recovery failed:`, error);
        }
    }, 800);
}

eventSource.on(event_types.APP_READY, () => scheduleLatestUnrenderedPicRecovery('app ready'));
eventSource.on(event_types.CHAT_CHANGED, () => scheduleLatestUnrenderedPicRecovery('chat change'));
eventSource.on(event_types.MESSAGE_SWIPED, () => scheduleLatestUnrenderedPicRecovery('swipe'));

/**
 * @param {number} [eventMessageId] Message id from MESSAGE_RECEIVED.
 * @param {string} [eventType] SillyTavern passes 'first_message' for a greeting.
 */
async function handleIncomingMessage(eventMessageId, eventType) {
    // 确保设置对象存在
    if (
        !extension_settings[extensionName] ||
        extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED
    ) {
        return;
    }
    // Per-chat disable — skip all auto-image generation in this chat.
    if (isChatDisabled()) {
        debugLog('chat disabled — skipping image generation');
        return;
    }

    const context = getContext();
    const messageId = context.chat.length - 1;
    const message = context.chat[messageId];

    // 检查是否是AI消息
    if (!message || message.is_user) {
        return;
    }

    const hoistedText = hoistPicsFromThink(message.mes);
    const hoistedFromThink = hoistedText !== String(message.mes || '');
    if (hoistedFromThink) {
        message.mes = hoistedText;
    }

    // A greeting is static card text, not a narrated beat: ST fires
    // MESSAGE_RECEIVED for it with type 'first_message' (script.js:7705). Its
    // own pic tags still render, but never invent one for it — the rescue pic
    // would be built from whatever VIR happens to exist and match nothing in
    // the scene.
    const isGreeting = eventType === 'first_message' || messageId === 0;
    const fallbackResult = await ensureInlinePicTags(messageId, message, { allowFallback: !isGreeting });
    if (fallbackResult.insertedCount > 0 && fallbackResult.finalText) {
        message.mes = fallbackResult.finalText;
    }
    if (fallbackResult.insertedCount > 0 || hoistedFromThink) {
        updateMessageBlock(messageId, message);
        await eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
        try { context.saveChat?.(); } catch { /* ignore */ }
    }
    if (hoistedFromThink) {
        upsertLastPicAudit({ messageId, hoistedFromThink: true, finalSlotInjection: true });
    }

    // 使用正则表达式search
    const imgTagRegex = getImageTagDetectionRegex();
    // const testRegex = regexFromString(extension_settings[extensionName].promptInjection.regex);
    let matches;
    const cleanTextMain = message.mes.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
    if (imgTagRegex.global) {
        matches = [...cleanTextMain.matchAll(imgTagRegex)];
    } else {
        const singleMatch = cleanTextMain.match(imgTagRegex);
        matches = singleMatch ? [singleMatch] : [];
    }
    debugLog('matched image tags', imgTagRegex, matches);
    const validMatches = collectValidPicMatches(matches);
    upsertLastPicAudit({
        messageId,
        visibleTagCount: validMatches.length,
        expectedBeatCount: fallbackResult.expectedBeatCount,
        hoistedFromThink,
        fallbackInserted: fallbackResult.insertedCount > 0,
        insertedCount: fallbackResult.insertedCount,
        finalSlotInjection: true,
        types: validMatches.map(({ originalTag }) => normalizeImageType(extractImageType(originalTag))),
    });
    if (matches.length > 0 && validMatches.length === 0) {
        console.warn(`[${extensionName}] Ignored ${matches.length} <pic> tag(s) with empty prompt.`);
    }
    if (validMatches.length > 0) {
        // 延迟执行图片生成，确保消息首先显示出来
        setTimeout(async () => {
            try {
                toastr.info(`Generating ${validMatches.length} images...`);
                const insertType = extension_settings[extensionName].insertType;

                // Initialize message.extra
                if (!message.extra) {
                    message.extra = {};
                }

                // Initialize media array (modern ST format — extra.image is a no-op getter in this ST version)
                if (!Array.isArray(message.extra.media)) {
                    message.extra.media = [];
                }

                // Get message element for UI updates
                const messageElement = $(
                    `.mes[mesid="${messageId}"]`,
                );

                // Process each matched image tag
                if (!message.extra.inlineImagePrompts) message.extra.inlineImagePrompts = {};
                if (!message.extra.inlineImageTypes) message.extra.inlineImageTypes = {};
                if (!message.extra.inlineImageVariants) message.extra.inlineImageVariants = {};
                for (const { originalIndex: picTagIndex, match, originalTag, prompt } of validMatches) {
                    const slotImageType = normalizeImageType(extractImageType(originalTag));

                    let imageUrl = null;
                    const key = makeImageJobKey(messageId, picTagIndex, prompt, slotImageType);

                    // Recover the background promise and await its completion safely!
                    if (window.stImageAutoGenTracker && window.stImageAutoGenTracker.has(key)) {
                        const trackedGeneration = window.stImageAutoGenTracker.get(key);
                        imageUrl = typeof trackedGeneration?.then === 'function' ? await trackedGeneration : null;
                    } else {
                        // Fallback in case the stream ended before we hooked it
                        const imageType = slotImageType;
                        const command = getGenerationCommand();
                        if (!command) {
                            toastr.warning('Image generation is not configured. Enable SillyTavern Image Generation and confirm /sd or /imagine works.');
                            throw new Error('No image generation slash command is available');
                        }
                        const dims = resolveResolution(imageType);
                        window.stImageAutoGenTracker.set(key, "pending");
                        setImageJobStatus(key, 'generating');
                        const effectivePrompt = buildEffectivePrompt(await lockIdentityLook(prompt));
                        warnVirDrift(effectivePrompt);
                        const cfgFb = extension_settings[extensionName] || {};
                        const negativeFb = String(cfgFb.negativePrompt || '').trim();
                        const cmdArgsFb = {
                            quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true',
                            processing: 'minimal',
                            extend: 'false',
                            width: String(dims.width),
                            height: String(dims.height),
                        };
                        if (negativeFb) cmdArgsFb.negative = negativeFb;
                        const promise = command.callback(cmdArgsFb, effectivePrompt);
                        window.stImageAutoGenTracker.set(key, promise);
                        imageUrl = await promise;
                        setImageJobStatus(key, imageUrl ? 'done' : 'failed');
                    }

                    debugLog('Generated image URL:', imageUrl);

                    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
                        setImageJobStatus(key, 'failed');
                        console.warn(`[${extensionName}] No image URL returned from /sd for prompt: ${prompt}`);
                        continue;
                    }

                    const currentTarget = context.chat[messageId];
                    if (!currentTarget || currentTarget.is_user || currentTarget !== message) {
                        setImageJobStatus(key, 'skipped');
                        console.warn(`[${extensionName}] Skipped image because target message ${messageId} changed or disappeared.`);
                        continue;
                    }

                    if (insertType === INSERT_TYPE.INLINE) {
                        // INLINE mode: push to media array (appears as gallery attachment below text)
                        const alreadyAdded = message.extra.media.some(
                            (m) => m.url === imageUrl,
                        );
                        if (!alreadyAdded) {
                            message.extra.media.push({
                                type: 'image',
                                url: imageUrl,
                                title: prompt,
                                source: 'generated',
                            });
                        }

                        // Set gallery display and inline flag
                        message.extra.media_display = 'gallery';
                        message.extra.media_index = message.extra.media.length - 1;
                        message.extra.inline_image = true;
                        message.extra.title = prompt;
                        message.extra.inlineImagePrompts['inline_img_' + picTagIndex] = prompt;
                        message.extra.inlineImageTypes['inline_img_' + picTagIndex] = slotImageType;
                        message.extra.inlineImageVariants['inline_img_' + picTagIndex] = [imageUrl];

                        // Update UI
                        appendMediaToMessage(message, messageElement);

                        // Save chat
                        await context.saveChat();
                        setImageJobStatus(key, 'done');
                    } else if (insertType === INSERT_TYPE.REPLACE) {
                        // REPLACE mode: inject markdown image inline in the message text
                        // Showdown converts ![alt](<url>) → <img> tag, DOMPurify allows it
                        const originalTag =
                            typeof match?.[0] === 'string' ? match[0] : '';
                        if (!originalTag) {
                            continue;
                        }
                        if (!String(message.mes || '').includes(originalTag)) {
                            setImageJobStatus(key, 'skipped');
                            console.warn(`[${extensionName}] Original <pic> tag was not found in target message ${messageId}`);
                            continue;
                        }

                        // Store the prompt in extra.title so the inline image viewer
                        // can recover it for regeneration (same as INLINE mode)
                        message.extra.title = prompt;
                        message.extra.inlineImagePrompts['inline_img_' + picTagIndex] = prompt;
                        message.extra.inlineImageTypes['inline_img_' + picTagIndex] = slotImageType;
                        message.extra.inlineImageVariants['inline_img_' + picTagIndex] = [imageUrl];

                        // Only encode spaces and parens in the URL — do NOT use encodeURI
                        // because it breaks @ and other valid path chars in ComfyUI filenames
                        const encodedUrl = encodeMarkdownUrl(imageUrl);
                        // Store the actual prompt in the alt text so the inline image viewer
                        // can recover it for regeneration. HTML-escape it for safe embedding.
                        // NOTE: We use a safe static alt text because SD prompts often contain
                        // brackets/parens that break Showdown's markdown parser.
                        // The real prompt is stored in msg.extra.title for recovery.
                        const safeAlt = 'generated image';
                        const mdImage = `\n\n![${safeAlt}](${encodedUrl})\n\n`;
                        message.mes = message.mes.replace(originalTag, mdImage);

                        // Re-render the message with the inline image
                        updateMessageBlock(messageId, message);
                        await eventSource.emit(
                            event_types.MESSAGE_UPDATED,
                            messageId,
                        );

                        // Save chat
                        await context.saveChat();
                        setImageJobStatus(key, 'done');
                    } else if (insertType === INSERT_TYPE.NEW_MESSAGE) {
                        setImageJobStatus(key, 'done');
                    }
                }
                toastr.success(
                    `${validMatches.length} images generated successfully`,
                );
            } catch (error) {
                toastr.error(`Image generation error: ${error}`);
                console.error('Image generation error:', error);
            }
        }, Math.max(0, parseInt(extension_settings[extensionName].generationDelayMs) || 0));
    }
}
