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
        position: 'deep_system', // deep_system, deep_user, deep_assistant
        depth: 0, // 0 = append at end (safe; after preset). >0 = N from end.
    },
    queueConcurrency: 1,
    generationDelayMs: 0,
    skipStreamingPregeneration: false,
    debug: false,
    resolutionProfile: 'custom',
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
    return String(url || '')
        // % MUST come first — encoding it after the others would re-escape
        // the %20/%28/etc we just inserted. Only encode bare % that is NOT
        // already part of a percent-encoded triplet (e.g. %20, %28).
        .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
        .replace(/ /g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
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
    }
}

// 加载设置
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    // 如果设置为空或缺少必要属性，使用默认设置
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], JSON.parse(JSON.stringify(defaultSettings)));
    } else {
        // 确保promptInjection对象存在
        if (!extension_settings[extensionName].promptInjection) {
            extension_settings[extensionName].promptInjection =
                defaultSettings.promptInjection;
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
                }
            }
        }

        // 确保insertType属性存在
        if (extension_settings[extensionName].insertType === undefined) {
            extension_settings[extensionName].insertType =
                defaultSettings.insertType;
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
            console.log('[' + extensionName + '] Auto-migrated legacy pic-tag regex to quote-aware version (fixes apostrophe truncation).');
        }

        // Migrate: add resolutionPresets if missing
        if (!extension_settings[extensionName].resolutionPresets) {
            extension_settings[extensionName].resolutionPresets =
                JSON.parse(JSON.stringify(defaultSettings.resolutionPresets));
        } else {
            // Ensure all default types are present
            for (const type in defaultSettings.resolutionPresets) {
                if (!extension_settings[extensionName].resolutionPresets[type]) {
                    extension_settings[extensionName].resolutionPresets[type] =
                        { ...defaultSettings.resolutionPresets[type] };
                }
            }
        }

        // Migrate: add defaultType if missing
        if (extension_settings[extensionName].defaultType === undefined) {
            extension_settings[extensionName].defaultType = defaultSettings.defaultType;
        }

        for (const key of ['queueConcurrency', 'generationDelayMs', 'skipStreamingPregeneration', 'debug', 'resolutionProfile']) {
            if (extension_settings[extensionName][key] === undefined) {
                extension_settings[extensionName][key] = defaultSettings[key];
            }
        }
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

// Inject pic-tag emission rules at IN_CHAT depth 1 — one position before the
// latest user message — so they are the freshest operating instruction the AI
// sees before generating.
//
// IMPORTANT: we inject with the 'user' role, NOT 'system'. Many presets enable
// squash_system_messages, which merges every system-role injection into one
// blob and reorders it — that buries this injection near the top of the prompt
// and destroys its depth-1 recency. A 'user'-role message is never squashed,
// so it stays exactly at depth 1, right before generation, on every preset.
const IMAGE_PROMPT_KEY = 'ST_IMAGE_AUTO_GEN';
const IMAGE_PROMPT_POSITION = 2; // IN_CHAT
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
            cfg.insertType === INSERT_TYPE.DISABLED;
        const userDepth = Number(cfg?.promptInjection?.depth);
        const depth = Number.isFinite(userDepth) && userDepth > 0 ? userDepth : 1;
        if (disabled) {
            setExtPrompt(IMAGE_PROMPT_KEY, '', IMAGE_PROMPT_POSITION, depth);
            return;
        }
        const prompt = cfg.promptInjection.prompt || '';
        // Force 'user' role so squash_system_messages can't merge-and-bury it.
        // (getMesRole() returns 'system' by default, which gets squashed.)
        const role = 'user';
        setExtPrompt(IMAGE_PROMPT_KEY, prompt, IMAGE_PROMPT_POSITION, depth, false, role);
        debugLog(`[${extensionName}] prompt injected IN_CHAT depth ${depth}, role=${role} (squash-proof)`);
    } catch (err) {
        console.error(`[${extensionName}] failed to register prompt`, err);
    }
}
// Initial registration + refresh hooks. The Prompt Manager reads its
// collection at generation time, so we only need to keep our entry up to date.
eventSource.on(event_types.APP_READY, refreshImagePromptInjection);
eventSource.on(event_types.CHAT_CHANGED, refreshImagePromptInjection);
eventSource.on(event_types.SETTINGS_UPDATED, refreshImagePromptInjection);
window.stImageAutoGenTracker = window.stImageAutoGenTracker || new Map();
window.stImageAutoGenStatuses = window.stImageAutoGenStatuses || new Map();
// Sequential generation queue — prevents flooding ComfyUI with parallel requests
// which causes model unload/reload thrashing
window.stImageGenQueue = window.stImageGenQueue || [];
window.stImageGenRunning = window.stImageGenRunning || false;

function makeImageJobKey(messageId, picIndex, prompt, imageType) {
    return `${messageId}:${picIndex}:${imageType || 'default'}:${normalizePromptKey(prompt)}`;
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
        const charPrefix = getCharacterSDPrefix();
        const effectivePrompt = charPrefix ? `${charPrefix}, ${prompt}` : prompt;
        const promise = command.callback(
            {
                quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true',
                processing: 'minimal',
                extend: 'false',
                width: String(dims.width),
                height: String(dims.height),
            },
            effectivePrompt
        );
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
    if (extension_settings[extensionName].skipStreamingPregeneration) return;
    const context = getContext();
    const msgId = context.chat.length - 1;
    const message = context.chat[msgId];
    if (!message || message.is_user || msgId !== context.chat.length - 1) return;
    if (!extension_settings[extensionName].promptInjection || !extension_settings[extensionName].promptInjection.regex) return;

    const imgTagRegex = regexFromString(extension_settings[extensionName].promptInjection.regex);
    let matches;
    const cleanTextDesktop = message.mes.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
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

    const context = getContext();
    const messageId = context.chat.length - 1;
    const message = context.chat[messageId];

    // 检查是否是AI消息
    if (!message || message.is_user) {
        return;
    }

    // 确保promptInjection对象和regex属性存在
    if (
        !extension_settings[extensionName].promptInjection ||
        !extension_settings[extensionName].promptInjection.regex
    ) {
        console.error('Prompt injection settings not properly initialized');
        return;
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
                        const charPrefix = getCharacterSDPrefix();
                        const effectivePrompt = charPrefix ? `${charPrefix}, ${prompt}` : prompt;
                        const promise = command.callback(
                            {
                                quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true',
                                processing: 'minimal',
                                extend: 'false',
                                width: String(dims.width),
                                height: String(dims.height),
                            },
                            effectivePrompt
                        );
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
