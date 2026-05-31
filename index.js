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
import { DEFAULT_PROMPT } from './default-prompt.js';

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

// 默认设置
const defaultSettings = {
    insertType: INSERT_TYPE.DISABLED,
    defaultType: 'square',
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
        // Quote-aware regex: matches prompt="..." (no embedded ") OR prompt='...' (no embedded ').
        // Older regex used [^"']* which truncated prompts at the FIRST apostrophe
        // (e.g. "ETSVin's shirt" became "ETSVin"). This pattern fires both branches
        // and the first non-empty capture group wins.
        regex: '/<pic\\b[^>]*\\sprompt=(?:"([^"]*)"|\'([^\']*)\')[^>]*\\/?>/g',
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
    qualityPrefix: '@xlvxp, masterpiece, highly detailed, very aesthetic, cinematic lighting.',
    qualityPrefixAuto: true,   // auto-prepend qualityPrefix if missing from the prompt
    sanitizePrompts: true,     // strip SD weight syntax, negations, URLs, fancy quotes
    virDriftWarn: false,       // warn when a VIR character is named without appearance terms
    enableDedupe: true,        // same prompt+type twice in one reply → one gen, two embeds
    allowFallbackTagInsertion: false,
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
        .replace(/\?/g, '%3F');
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

const NEG_WORD_RE = /\b(?:no|not|without|never|avoid|exactly|only)\b\s+[\w'’-]+(?:\s+[\w'’-]+){0,4}/gi;
const SD_WEIGHT_PAREN_RE = /\(([^()]*?):\s*-?\d+(?:\.\d+)?\s*\)/g;
const SD_WEIGHT_BRACKET_RE = /\[([^\[\]]*?):\s*-?\d+(?:\.\d+)?\s*\]/g;
const GEN_PARAM_RE = /\b(?:width|height|steps|seed|cfg|sampler|model|negative[_ ]?prompt|variant)\s*[:=]\s*\S+/gi;

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
    // 5) Negation phrases — Qwen paints the noun, so "no extra people" → extra people
    const negMatches = text.match(NEG_WORD_RE);
    if (negMatches?.length) {
        debugLog(`[${extensionName}] sanitizer stripped ${negMatches.length} negation phrase(s):`, negMatches);
        text = text.replace(NEG_WORD_RE, ' ');
    }
    // 6) Standalone problem descriptors that cause artifacts
    text = text.replace(/\b(duplicate|duplicates|multiple\s+heads|extra\s+\w+)\b/gi, ' ');
    // 7) Whitespace / dangling punctuation cleanup
    text = text.replace(/\s+([.,;:!?])/g, '$1')
               .replace(/[.,;:]\s*([.,;:])/g, '$1')
               .replace(/\s+/g, ' ')
               .trim();
    // 8) Length cap (Qwen tops out ~512 tokens — generous char cap leaves headroom)
    if (text.length > 1800) {
        const cut = text.lastIndexOf(' ', 1800);
        text = (cut > 1500 ? text.slice(0, cut) : text.slice(0, 1800)).trim();
    }
    return text;
}

function ensureQualityPrefix(prompt) {
    const cfg = extension_settings[extensionName] || {};
    if (!cfg.qualityPrefixAuto) return prompt;
    const prefix = String(cfg.qualityPrefix || '').trim();
    if (!prefix) return prompt;
    // Primary path is now AI-authored: the prompt template instructs the model
    // to write the leading artist tag (first token of the quality prefix, e.g.
    // "@xlvxp") itself. If it already did, treat the prefix as handled and do
    // NOT inject — code injection here is only a fallback for replies that omit
    // the tag entirely.
    const firstTok = prefix.split(',')[0].trim().toLowerCase();
    if (firstTok) {
        const headStart = String(prompt || '').replace(/^[\s"']+/, '').slice(0, firstTok.length + 2).toLowerCase();
        if (headStart.startsWith(firstTok)) return String(prompt || '').trim();
    }
    // Cheap match: first ~80 chars contain the prefix verbatim or the @xlvxp tag
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
function buildEffectivePrompt(rawPrompt) {
    let p = sanitizeForAnimaQwen(rawPrompt);
    p = ensureQualityPrefix(p);
    p = applyLoraTriggers(p);
    p = normalizePromptPeopleCount(p);
    const charPrefix = getCharacterSDPrefix();
    if (charPrefix) {
        // Don't double-prepend an artist/style tag that the quality prefix
        // already placed at the head. The user's per-character SD prefix is
        // often the same artist tag as qualityPrefix (e.g. "@xlvxp"), which
        // would otherwise yield "@xlvxp, @xlvxp, masterpiece, ...".
        const head = p.slice(0, charPrefix.length + 4).toLowerCase();
        if (!head.startsWith(charPrefix.toLowerCase())) {
            p = `${charPrefix}, ${p}`;
        }
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

// Extract the type attribute value from a full <pic ...> tag string
function extractImageType(tagString) {
    if (typeof tagString !== 'string') return null;
    const m = tagString.match(/\btype=['"](\w+)['"]/i);
    return m ? m[1].toLowerCase() : null;
}

function normalizeImageType(imageType) {
    const settings = extension_settings[extensionName] || {};
    const presets = settings.resolutionPresets || defaultSettings.resolutionPresets;
    const defaultType = settings.defaultType || 'square';
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
        $('#prompt_injection_text').val(
            extension_settings[extensionName].promptInjection.prompt,
        );
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
            extension_settings[extensionName].defaultType || 'square',
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

        // Auto-migrate previous bundled prompt contracts to the current
        // strengthened anchor-based version. This updates installs that still
        // have an older default prompt saved in settings.json.
        const currentPrompt = String(
            extension_settings[extensionName].promptInjection.prompt || '',
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
        const usesOutdatedCurrentBundledPrompt =
            (
                currentPrompt.includes('[OVERRIDE PRECEDENCE - highest priority for this reply]')
                || currentPrompt.includes('[REASONING OVERRIDE')
            )
            && !currentPrompt.includes('generalize the same way for any act');
        const usesLegacyVerbosePrompt = verbosePromptMarkers.every((marker) =>
            currentPrompt.includes(marker),
        );
        const usesOlderBundledPrompt = priorPromptMarkers.some((marker) =>
            currentPrompt.includes(marker),
        ) && !currentPrompt.includes('[OVERRIDE PRECEDENCE - highest priority for this reply]');
        if (usesLegacyVerbosePrompt || usesOlderBundledPrompt || usesOutdatedCurrentBundledPrompt) {
            extension_settings[extensionName].promptInjection.prompt =
                defaultSettings.promptInjection.prompt;
            settingsChanged = true;
            console.log(
                `[${extensionName}] Auto-migrated older bundled Anima prompt to detailed VIR-driven contract.`,
            );
        }

        // Auto-migrate broken/legacy pic-tag regexes to the current quote-aware default.
        // The OLD default used [^"']* which truncated prompts at the first apostrophe
        // ("ETSVin's shirt" → "ETSVin"). Any user still on that pattern should be upgraded.
        const legacyPicRegexes = [
            '/<pic[^>]*\\sprompt=[\'"]([\\s\\S]*?)[\'"]\\s*>/g',
            '/<pic[^>]*\\sprompt=[\'"]([\\s\\S]*?)[\'"]\\s*\\/?>/g',
            // Old broken default (truncated at apostrophe):
            '/<pic\\b(?=[^>]*\\sprompt=["\'][^"\']*["\'])[^>]*\\sprompt=["\']([^"\']*)["\'][^>]*\\/?>/g',
        ];
        if (legacyPicRegexes.includes(extension_settings[extensionName].promptInjection.regex)) {
            extension_settings[extensionName].promptInjection.regex = defaultSettings.promptInjection.regex;
            settingsChanged = true;
            console.log('[' + extensionName + '] Auto-migrated legacy pic-tag regex to quote-aware version (fixes apostrophe truncation).');
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

        for (const key of [
            'queueConcurrency', 'generationDelayMs', 'skipStreamingPregeneration', 'debug', 'resolutionProfile',
            'negativePrompt', 'qualityPrefix', 'qualityPrefixAuto', 'sanitizePrompts', 'virDriftWarn', 'enableDedupe', 'allowFallbackTagInsertion', 'loraTriggers', 'lastPicAudit',
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
    });

    $('#prompt_injection_text').on('input', function () {
        extension_settings[extensionName].promptInjection.prompt =
            $(this).val();
        saveSettingsDebounced();
        refreshImagePromptInjection();
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
        try { refreshImagePromptInjection(); } catch { /* ignore */ }
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
        extension_settings[extensionName].promptInjection.prompt = defaultSettings.promptInjection.prompt;
        $('#prompt_injection_text').val(defaultSettings.promptInjection.prompt);
        saveSettingsDebounced();
        refreshImagePromptInjection();
        toastr.info('Prompt template reset to default.');
    });

    $('#image_generation_test_regex').on('click', function () {
        try {
            const regex = regexFromString(extension_settings[extensionName].promptInjection.regex);
            const sample = `Narration before. <pic prompt="masterpiece, cinematic portrait, red cloak" type="portrait"> Narration after.`;
            const matches = regex.global ? [...sample.matchAll(regex)] : (sample.match(regex) ? [sample.match(regex)] : []);
            const prompt = matches?.[0]?.[1];
            if (prompt) {
                toastr.success(`Regex works. Captured prompt: ${prompt}`);
            } else {
                toastr.warning('Regex did not capture a prompt. Capture group 1 must be the prompt text.');
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
        const prompt = cfg.promptInjection.prompt || '';
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
        const visiblePicTag = /<pic\b[^>]*prompt=/i.test(mes);
        const visibleImageMd = /!\[generated image\]/i.test(mes);
        const reasoningPicOnly = !visiblePicTag && !visibleImageMd && /<pic\b/i.test(reasoning);

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
        const effectivePrompt = buildEffectivePrompt(prompt);
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
            // Quote-aware regex has 2 capture groups: [1] for double-quoted,
            // [2] for single-quoted. Whichever quote style was used yields a
            // non-empty group; the other is undefined. Pick the populated one.
            const prompt = (typeof match?.[1] === 'string' && match[1].length > 0) ? match[1]
                         : (typeof match?.[2] === 'string') ? match[2]
                         : '';
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
    return Math.min(4, strong);
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
    const combined = `${String(fullText || '')} ${String(localText || '')}`.toLowerCase();
    const entries = Object.values(allCopies || {});
    const named = entries.filter((entry) => combined.includes(String(entry?.name || '').toLowerCase()));
    if (named.length) return named.slice(0, 3);
    const tiered = entries
        .filter((entry) => ['PIN', 'ACT'].includes(String(entry?.tier || '').toUpperCase()))
        .slice(0, 2);
    if (tiered.length) return tiered;
    return entries.slice(0, 2);
}

async function buildFallbackTagForBeat(chunk, fullText) {
    const localBeatText = typeof chunk === 'string' ? chunk : chunk?.text || '';
    const allCopies = typeof window.ff4VirGetPicCopies === 'function'
        ? await window.ff4VirGetPicCopies()
        : {};
    const activeEntries = pickActivePicCopyEntries(fullText, localBeatText, allCopies);
    const names = activeEntries.map((entry) => entry.name).filter(Boolean);
    const contextWindow = buildFallbackContextWindow(typeof chunk === 'string' ? null : chunk, fullText);
    const sceneAnchors = selectSceneAnchors(contextWindow);
    const spatialLayout = buildSpatialLayoutSentence(activeEntries, contextWindow);
    const actionFocus = buildActionFocusSentence(contextWindow, sceneAnchors);
    const combinedContext = [contextWindow, ...activeEntries.map((entry) => entry?.pic_copy)].join(' ');
    const imageType = normalizeImageType(inferImageTypeFromBeat(combinedContext, names.length));
    const countSentence = names.length > 0
        ? `${names.length} ${names.length === 1 ? 'person is' : 'people are'} in the picture.`
        : '';
    const promptBody = [
        inferRatingSentence(combinedContext),
        countSentence,
        ...sceneAnchors,
        spatialLayout,
        'Keep each character\'s clothing, exposure level, underwear, accessories, and equipment exactly as currently described unless this exact visible moment explicitly changes them.',
        'Sexual action alone does not imply nudity or removed clothing for any other character.',
        ...activeEntries.map((entry) => humanizePicCopy(entry?.pic_copy)).filter(Boolean),
        actionFocus,
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
    cfg.lastPicAudit = {
        ...current,
        ...patch,
        at: new Date().toISOString(),
    };
}

async function ensureInlinePicTags(messageId, message) {
    const text = String(message?.mes || '');
    const cfg = extension_settings[extensionName] || {};
    if (!text.trim()) return { insertedCount: 0, expectedBeatCount: 0, visibleTagCount: 0, finalText: text };

    const imgTagRegex = ensureGlobalRegex(regexFromString(cfg.promptInjection.regex));
    const visibleMatches = collectValidPicMatches([...text.matchAll(imgTagRegex)]);
    const maskedText = maskRanges(text, [imgTagRegex, /<details[\s\S]*?<\/details>/gi]);
    const expectedBeatCount = Math.max(1, Math.min(cfg.maxPicsPerMessage || 4, detectExpectedBeatCount(maskedText)));
    const visibleTagCount = visibleMatches.length;

    if (cfg.allowFallbackTagInsertion !== true) {
        upsertLastPicAudit({
            messageId,
            visibleTagCount,
            expectedBeatCount,
            hoistedFromThink: false,
            fallbackInserted: false,
            insertedCount: 0,
            finalSlotInjection: true,
            fallbackDisabled: true,
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
    const targetBeatCount = Math.max(1, Math.min(cfg.maxPicsPerMessage || 4, expectedBeatCount));
    const chosenChunks = chooseBeatChunks(chunks, targetBeatCount);
    const missingCount = Math.max(0, Math.min((cfg.maxPicsPerMessage || 4) - visibleTagCount, targetBeatCount - visibleTagCount));
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
    const picTag = /<pic\b[^>]*>/gi;
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

eventSource.on(event_types.STREAM_TOKEN_RECEIVED, async function () {
    if (!extension_settings[extensionName] || extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED) return;
    if (isChatDisabled()) return;
    if (extension_settings[extensionName].skipStreamingPregeneration) return;
    const context = getContext();
    const msgId = context.chat.length - 1;
    const message = context.chat[msgId];
    if (!message || message.is_user || msgId !== context.chat.length - 1) return;
    if (!extension_settings[extensionName].promptInjection || !extension_settings[extensionName].promptInjection.regex) return;

    const imgTagRegex = regexFromString(extension_settings[extensionName].promptInjection.regex);
    let matches;
    const hoistedStreamText = hoistPicsFromThink(message.mes);
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
async function handleIncomingMessage() {
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

    // 确保promptInjection对象和regex属性存在
    if (
        !extension_settings[extensionName].promptInjection ||
        !extension_settings[extensionName].promptInjection.regex
    ) {
        console.error('Prompt injection settings not properly initialized');
        return;
    }

    const fallbackResult = await ensureInlinePicTags(messageId, message);
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
    const imgTagRegex = regexFromString(
        extension_settings[extensionName].promptInjection.regex,
    );
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
                        const effectivePrompt = buildEffectivePrompt(prompt);
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
