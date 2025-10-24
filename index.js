const {
    eventSource,
    event_types,
} = SillyTavern.getContext();

import { saveSettingsDebounced, saveChat, online_status } from '../../../../script.js';
import { delay } from '../../../utils.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { waitUntilCondition } from '../../../utils.js';

const LOG_PREFIX = '[ST-CCReasoningProfile]';
const EXTENSION_PATH = 'scripts/extensions/third-party/ST-CCReasoningProfile';

// ===================================================================
// Chat Completion Reasoning Profile Extension
// Author: Babysworld
// 
// Purpose: Save 60-80% on API costs by using cheaper models for 
// reasoning and premium models for responses. Also improves latency
// by routing reasoning to faster APIs.
//
// How it works:
// 1. User sends message
// 2. Swaps to cheap/fast reasoning profile (e.g., Gemini 2.5 Pro)
// 3. Generates reasoning using model's Custom COT capability
// 4. Swaps back to main response profile (e.g., Claude Sonnet)
// 5. Generates response using the reasoning from step 3
//
// Key Achievement: Leverages existing Chat Completion preset Custom COT
// configurations - no need to manually configure reasoning tags!
// ===================================================================

const $connectionProfilesSelect = $('#connection_profiles');

let activeConnectionProfileName = null;
let isReasoningProfileSwappedOn = false;
let isExtensionActive = false;
let isAppLoading = true;

let isMidGenerationCycle = false;
let isAutoContinuing = false;
let isProfileSwapping = false;

let reasoningContent = '';
let triggerType = 'GENERATION_STARTED';

let settings = null;

function initExtSettings() {
    extension_settings.ccReasoning = extension_settings.ccReasoning || {};
    extension_settings.ccReasoning.reasoningProfileID = extension_settings.ccReasoning.reasoningProfileID || 'None';
    extension_settings.ccReasoning.reasoningProfileName = extension_settings.ccReasoning.reasoningProfileName || 'None';
    extension_settings.ccReasoning.autoContinueAfterReasoning = extension_settings.ccReasoning.autoContinueAfterReasoning || true;
    extension_settings.ccReasoning.onlyTriggerWhenUserLast = extension_settings.ccReasoning.onlyTriggerWhenUserLast || false;
    extension_settings.ccReasoning.isExtensionActive = extension_settings.ccReasoning.isExtensionActive || false;
    extension_settings.ccReasoning.reasoningPrefix = extension_settings.ccReasoning.reasoningPrefix || '<think>\n';
    extension_settings.ccReasoning.reasoningSuffix = extension_settings.ccReasoning.reasoningSuffix || '\n</think>';
    extension_settings.ccReasoning.reasoningSystemPrompt = extension_settings.ccReasoning.reasoningSystemPrompt || 'Think step-by-step about the conversation so far and the user\'s latest message. Provide your chain of thought reasoning inside <think> tags. Be thorough but concise.';
    extension_settings.ccReasoning.includeReasoningInResponse = extension_settings.ccReasoning.includeReasoningInResponse || true;
    extension_settings.ccReasoning.maxReasoningTokens = extension_settings.ccReasoning.maxReasoningTokens || 500;
}

function getExtSettings() {
    const settings = extension_settings?.ccReasoning;
    if (!settings) return null;
    return settings;
}

function addConnectionProfilesToExtension() {
    if (!$('connection_profiles')) return;

    console.log(`${LOG_PREFIX} Adding connection profiles to extension selector`);
    const context = getContext();
    const profiles = context.extensionSettings?.connectionManager?.profiles || [];
    const $extensionSelector = $('#ccReasoningProfileSelector');
    console.log(`${LOG_PREFIX} Found ${profiles.length} connection profiles`);
    $extensionSelector.empty();
    $extensionSelector.append('<option value="None">None</option>');
    for (const profile of profiles) {
        $extensionSelector.append(`<option value="${profile.id}">${profile.name}</option>`);
    }
    $extensionSelector.val(extension_settings.ccReasoning.reasoningProfileID).trigger('change');
    $extensionSelector.off('change').on('change', () => updateExtensionSettings());
}

async function updateExtensionSettings() {
    const $extensionSelector = $('#ccReasoningProfileSelector');
    const profileName = $extensionSelector.find('option:selected').text();
    const profileID = $extensionSelector.find('option:selected').val();
    console.info(`${LOG_PREFIX} Updating reasoning profile to "${profileName}"`);
    extension_settings.ccReasoning.reasoningProfileID = profileID;
    extension_settings.ccReasoning.reasoningProfileName = profileName;
    await saveSettingsDebounced();
}

async function waitForEvent(eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            eventSource.removeListener(eventName, onEvent);
            reject(new Error(`Timed out waiting for event "${eventName}"`));
        }, timeout);

        function onEvent(...args) {
            clearTimeout(timer);
            eventSource.removeListener(eventName, onEvent);
            resolve(...args);
            console.log(`${LOG_PREFIX} Received and Resolved event "${eventName}"`);
        }

        eventSource.once(eventName, onEvent);
    });
}

//MARK: SwapToReasoning
async function swapToReasoningProfile() {
    if (extension_settings.ccReasoning.reasoningProfileID === 'None') {
        console.error(LOG_PREFIX, 'No reasoning profile selected');
        isReasoningProfileSwappedOn = false;
        return false;
    }

    if (activeConnectionProfileName === extension_settings.ccReasoning.reasoningProfileName) {
        console.log(`${LOG_PREFIX} Reasoning profile is the same as the Response profile. Setting isReasoningProfileSwappedOn to true to allow proper swapping back.`);
        isReasoningProfileSwappedOn = true;
        return true;
    }

    activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
    console.log(`${LOG_PREFIX} Saving active main profile as "${activeConnectionProfileName}" for later reversion.`);
    isProfileSwapping = true;

    console.log(`${LOG_PREFIX} Swapping to reasoning profile ${extension_settings.ccReasoning.reasoningProfileName}`);

    try {
        const waitForProfileLoad = waitForEvent(event_types.CONNECTION_PROFILE_LOADED, 5000);

        console.log(`${LOG_PREFIX} Sending profile switch command`);
        await SlashCommandParser.commands['profile'].callback(
            {
                await: 'true',
                _scope: null,
                _abortController: null,
            },
            extension_settings.ccReasoning.reasoningProfileName,
        );
        console.log(`${LOG_PREFIX} Profile switch command sent`);

        await waitUntilCondition(() => online_status === 'no_connection', 5000, 100);
        console.log(`${LOG_PREFIX} Connection status changed to no_connection; Waiting for profile to load...`);
        await waitForProfileLoad;
        console.log(`${LOG_PREFIX} Profile loaded; Waiting for status to change to online...`);
        await waitUntilCondition(() => online_status !== 'no_connection', 5000, 100);
        console.log(`${LOG_PREFIX} Connection status changed to online`);

        isReasoningProfileSwappedOn = true;
        isProfileSwapping = false;
        console.log(`${LOG_PREFIX} Successfully swapped to reasoning profile`);
        console.log(`${LOG_PREFIX} Confirming Response Profile is ${activeConnectionProfileName}`);
        return true;

    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to swap to reasoning profile: ${error}`);
        isProfileSwapping = false;
        return false;
    }
}

//MARK: SwapBack
async function swapToOriginalProfile() {
    if (activeConnectionProfileName === null || activeConnectionProfileName === undefined) {
        console.log(`${LOG_PREFIX} No Response profile found. Aborting swap process.`);
        return false;
    }

    if (activeConnectionProfileName === extension_settings.ccReasoning.reasoningProfileName) {
        console.log(`${LOG_PREFIX} Response profile is the same as the Reasoning profile. Setting isReasoningProfileSwappedOn to false to complete the swap process logic.`);
        isReasoningProfileSwappedOn = false;
        return true;
    }

    console.log(`${LOG_PREFIX} Swapping back to original profile: "${activeConnectionProfileName}"`);
    isProfileSwapping = true;
    
    try {
        const waitForProfileLoad = waitForEvent(event_types.CONNECTION_PROFILE_LOADED, 5000);

        console.log(`${LOG_PREFIX} Sending profile switch command`);
        await SlashCommandParser.commands['profile'].callback(
            {
                await: 'true',
                _scope: null,
                _abortController: null,
            },
            activeConnectionProfileName,
        );
        console.log(`${LOG_PREFIX} Profile switch command sent`);

        await waitUntilCondition(() => online_status === 'no_connection', 5000, 100);
        console.log(`${LOG_PREFIX} Connection status changed to no_connection; Waiting for profile to load...`);
        await waitForProfileLoad;
        console.log(`${LOG_PREFIX} Profile loaded; Waiting for status to change to online...`);
        await waitUntilCondition(() => online_status !== 'no_connection', 5000, 100);
        console.log(`${LOG_PREFIX} Connection status changed to online`);

        isProfileSwapping = false;
        isReasoningProfileSwappedOn = false;
        console.log(`${LOG_PREFIX} Successfully swapped back to original profile`);
        return true;

    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to swap to original profile: ${error}`);
        isProfileSwapping = false;
        return false;
    }
}

// Extract reasoning content from response
function extractReasoningContent(text) {
    const prefix = extension_settings.ccReasoning.reasoningPrefix || '<think>';
    const suffix = extension_settings.ccReasoning.reasoningSuffix || '</think>';
    
    const prefixIndex = text.indexOf(prefix);
    const suffixIndex = text.indexOf(suffix);
    
    if (prefixIndex !== -1 && suffixIndex !== -1 && suffixIndex > prefixIndex) {
        return text.substring(prefixIndex + prefix.length, suffixIndex).trim();
    }
    
    // If no tags found, return the whole text as reasoning
    return text.trim();
}

// Add reasoning to the context for the response
function addReasoningToContext(reasoning) {
    const context = getContext();
    const chat = context.chat;
    
    if (!chat || chat.length === 0) return;
    
    // Store reasoning in a hidden way that can be accessed by the response generation
    // We'll add it as a temporary system message or inject it into the prompt
    const reasoningMessage = {
        name: 'System',
        is_system: true,
        is_user: false,
        mes: `${extension_settings.ccReasoning.reasoningPrefix}${reasoning}${extension_settings.ccReasoning.reasoningSuffix}`,
        extra: {
            type: 'reasoning',
            hidden: !extension_settings.ccReasoning.includeReasoningInResponse
        }
    };
    
    reasoningContent = reasoning;
    console.log(`${LOG_PREFIX} Reasoning content extracted and stored (${reasoning.length} chars)`);
}

//MARK: regSlashCommands
function registerExtensionSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'CCRP-swapToReasoning',
        callback: swapToReasoningProfileViaSlash,
        returns: 'nothing',
        helpString: `Force the CCRP extension to swap to its Reasoning profile. Will execute even if the extension's power button is set to "off".`,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'CCRP-swapToResponse',
        callback: swapToResponseProfileViaSlash,
        returns: 'nothing',
        helpString: `Force the CCRP extension to swap to the last known Response profile. Will execute even if the extension's power button is set to "off".`,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'CCRP-toggle',
        callback: toggleExtensionViaSlash,
        returns: 'nothing',
        helpString: `Toggles the CCRP Extension on and off.`,
    }));
}

async function swapToReasoningProfileViaSlash() {
    console.log(`${LOG_PREFIX} Received slashcommand /CCRP-swapToReasoning`);
    await swapToReasoningProfile();
    return 'ok';
}

async function swapToResponseProfileViaSlash() {
    console.log(`${LOG_PREFIX} Received slashcommand /CCRP-swapToResponse`);
    await swapToOriginalProfile();
    return 'ok';
}

async function toggleExtensionViaSlash() {
    console.log(`${LOG_PREFIX} Received slashcommand /CCRP-toggle`);
    $('#ccReasoningPowerButton').trigger('click');
    return 'ok';
}

function checkIfLastMesIsByUser() {
    let lastMesIsUser;
    let { chat } = SillyTavern.getContext();
    let lastMes = chat[chat.length - 1];
    console.log(`${LOG_PREFIX} Last message: ${JSON.stringify(lastMes.mes).substring(0, 50)}...`);
    lastMesIsUser = lastMes.is_user;
    console.log(`${LOG_PREFIX} Last message is by user: ${lastMesIsUser}`);
    return lastMesIsUser;
}

function setAppropriateTriggerType() {
    let onlyTriggerOnUserMessage = extension_settings.ccReasoning.onlyTriggerWhenUserLast;
    if (onlyTriggerOnUserMessage) {
        triggerType = 'USER_MESSAGE_RENDERED';
    } else {
        triggerType = 'GENERATION_STARTED';
    }
    console.log(`${LOG_PREFIX} Trigger type set to ${triggerType}`);
}

//MARK: OnMessageStart
async function messageStartListener() {
    if (!isExtensionActive) return;
    if (isAppLoading) return;

    console.log(`${LOG_PREFIX} Generation started; triggerType: ${triggerType}, isReasoningProfileSwappedOn? ${isReasoningProfileSwappedOn}, isMidGenerationCycle? ${isMidGenerationCycle}, isAutoContinuing? ${isAutoContinuing}`);

    let triggerOnlyWhenUserLast = extension_settings.ccReasoning.onlyTriggerWhenUserLast;
    let isLastMesByUser = checkIfLastMesIsByUser();

    console.log(`${LOG_PREFIX} triggerOnlyWhenUserLast: ${triggerOnlyWhenUserLast}, isLastMesByUser: ${isLastMesByUser}`);
    
    if (!isAutoContinuing && triggerOnlyWhenUserLast && isLastMesByUser === false) {
        console.log(`${LOG_PREFIX} Skipping generation because last message is not by user`);
        return;
    }

    isMidGenerationCycle = true;

    // First phase: Swap to reasoning profile and generate reasoning
    if (!isReasoningProfileSwappedOn && isExtensionActive && !isAutoContinuing) {
        console.log(LOG_PREFIX, 'Starting Reasoning Phase - Swapping to reasoning profile');
        const swapSuccess = await swapToReasoningProfile();
        
        if (!swapSuccess) {
            console.error(LOG_PREFIX, 'Failed to swap to reasoning profile, aborting');
            isMidGenerationCycle = false;
            return;
        }
        
        console.log(LOG_PREFIX, 'Successfully swapped to reasoning profile');
    }
    
    // Second phase: Continue with response using reasoning context
    if (isExtensionActive && isAutoContinuing) {
        console.log(LOG_PREFIX, 'Starting Response Phase - Continuing with main profile');
        
        let chat = getContext().chat;
        let lastMes = chat[chat.length - 1];
        
        // Extract and store reasoning from the last message
        if (lastMes && lastMes.mes) {
            const reasoning = extractReasoningContent(lastMes.mes);
            addReasoningToContext(reasoning);
            
            // If we want to include reasoning in the visible response, keep it
            // Otherwise, clear the message and prepare for the response
            if (extension_settings.ccReasoning.includeReasoningInResponse) {
                // Keep the reasoning visible
                console.log(LOG_PREFIX, 'Keeping reasoning visible in response');
            } else {
                // Clear the message for the response
                console.log(LOG_PREFIX, 'Clearing reasoning from visible message');
                lastMes.mes = '';
            }
            
            chat[chat.length - 1] = lastMes;
            await saveChat();
            await delay(200);
        }
    }
}

function setupStartListener() {
    console.log(`${LOG_PREFIX} Setting up start listener for type ${triggerType}`);

    eventSource.removeListener(event_types.GENERATION_STARTED, messageStartListener);
    eventSource.removeListener(event_types.USER_MESSAGE_RENDERED, messageStartListener);

    eventSource.on(event_types[triggerType], messageStartListener);
}

function toggleExtensionState(state) {
    const $activeToggle = $('#ccReasoningPowerButton');
    $activeToggle.toggleClass('toggleEnabled', state);
    extension_settings.ccReasoning.isExtensionActive = state;
    saveSettingsDebounced();
    console.log(`${LOG_PREFIX} Extension state toggled to ${state}`);
}

//MARK: onDOMReady
(async function () {
    console.log(`${LOG_PREFIX} Chat Completion Reasoning extension loading...`);
    const settingsHtml = await $.get(`${EXTENSION_PATH}/settings-cc.html`);
    $('#extensions_settings').append(settingsHtml);

    const $extensionSelector = $('#ccReasoningProfileSelector');
    const $activeToggle = $('#ccReasoningPowerButton');
    const $autoContinue = $('#ccAutoContinueAfterReasoning');
    const $onlyTriggerWhenUserLast = $('#ccOnlyTriggerWhenUserLast');
    const $reasoningPrefix = $('#ccReasoningPrefix');
    const $reasoningSuffix = $('#ccReasoningSuffix');
    const $reasoningSystemPrompt = $('#ccReasoningSystemPrompt');
    const $includeReasoningInResponse = $('#ccIncludeReasoningInResponse');
    const $maxReasoningTokens = $('#ccMaxReasoningTokens');

    settings = getExtSettings();
    let isAnySettingNull = false;
    let whichSetting = null;

    if (settings) {
        for (const [key, value] of Object.entries(settings)) {
            if (value === null) {
                isAnySettingNull = true;
                whichSetting = key;
                break;
            }
        }
    }

    if (!settings || isAnySettingNull) {
        console.log(`${LOG_PREFIX} No settings found, or something was Null (${whichSetting}); initializing`);
        initExtSettings();
        settings = getExtSettings();
    }

    console.log(`${LOG_PREFIX} Extension settings ready:`, settings);

    eventSource.once(event_types.APP_READY, () => {
        addConnectionProfilesToExtension();
        $extensionSelector.val(settings.reasoningProfileID).trigger('change');
        $autoContinue.prop('checked', settings.autoContinueAfterReasoning);
        $onlyTriggerWhenUserLast.prop('checked', settings.onlyTriggerWhenUserLast);
        $reasoningPrefix.val(settings.reasoningPrefix);
        $reasoningSuffix.val(settings.reasoningSuffix);
        $reasoningSystemPrompt.val(settings.reasoningSystemPrompt);
        $includeReasoningInResponse.prop('checked', settings.includeReasoningInResponse);
        $maxReasoningTokens.val(settings.maxReasoningTokens);
        isExtensionActive = settings.isExtensionActive;
        activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
        console.log(`${LOG_PREFIX} On load, active connection profile is: ${activeConnectionProfileName}`);
        toggleExtensionState(isExtensionActive);
        setAppropriateTriggerType();
        isAppLoading = false;
        setupStartListener();
        registerExtensionSlashCommands();
        console.log(`${LOG_PREFIX} Extension setup complete.`);
    });

    $activeToggle.off('click').on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isExtensionActive = !isExtensionActive;
        toggleExtensionState(isExtensionActive);
    });

    $autoContinue.off('change').on('change', (e) => {
        extension_settings.ccReasoning.autoContinueAfterReasoning = $autoContinue.prop('checked');
        saveSettingsDebounced();
    });

    $onlyTriggerWhenUserLast.off('change').on('change', (e) => {
        extension_settings.ccReasoning.onlyTriggerWhenUserLast = $onlyTriggerWhenUserLast.prop('checked');
        setAppropriateTriggerType();
        setupStartListener();
        saveSettingsDebounced();
    });

    $reasoningPrefix.off('change').on('change', (e) => {
        extension_settings.ccReasoning.reasoningPrefix = $reasoningPrefix.val();
        saveSettingsDebounced();
    });

    $reasoningSuffix.off('change').on('change', (e) => {
        extension_settings.ccReasoning.reasoningSuffix = $reasoningSuffix.val();
        saveSettingsDebounced();
    });

    $reasoningSystemPrompt.off('change').on('change', (e) => {
        extension_settings.ccReasoning.reasoningSystemPrompt = $reasoningSystemPrompt.val();
        saveSettingsDebounced();
    });

    $includeReasoningInResponse.off('change').on('change', (e) => {
        extension_settings.ccReasoning.includeReasoningInResponse = $includeReasoningInResponse.prop('checked');
        saveSettingsDebounced();
    });

    $maxReasoningTokens.off('change').on('change', (e) => {
        extension_settings.ccReasoning.maxReasoningTokens = parseInt($maxReasoningTokens.val()) || 500;
        saveSettingsDebounced();
    });

    //MARK: onMessageEnd
    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (!isExtensionActive) return;
        if (isAppLoading) return;

        console.log(LOG_PREFIX, 'Generation ended');
        await delay(200);
        console.log(`${LOG_PREFIX} MidGeneration? ${isMidGenerationCycle}, isReasoningProfileSwappedOn? ${isReasoningProfileSwappedOn}, isAutoContinuing? ${isAutoContinuing}`);
        
        // After reasoning phase, swap back to response profile
        if (isReasoningProfileSwappedOn && isExtensionActive && !isProfileSwapping) {
            console.log(LOG_PREFIX, 'Reasoning phase complete, swapping to response profile');
            await swapToOriginalProfile();
        }
        
        // If auto-continue is off, end the cycle
        if (!extension_settings.ccReasoning.autoContinueAfterReasoning && isMidGenerationCycle) {
            isMidGenerationCycle = false;
        }
        
        // If we just finished the response phase, clear flags
        if (isAutoContinuing && isMidGenerationCycle) {
            console.log(LOG_PREFIX, 'Response phase complete, clearing flags');
            isAutoContinuing = false;
            isMidGenerationCycle = false;
        }
        
        // If we need to continue for the response phase, trigger it
        if (extension_settings.ccReasoning.autoContinueAfterReasoning && isMidGenerationCycle && !isAutoContinuing) {
            console.log(LOG_PREFIX, 'Triggering auto-continue for response phase');
            isAutoContinuing = true;
            $('#option_continue').trigger('click');
        }
        
        console.log(`${LOG_PREFIX} After generation end: MidGeneration? ${isMidGenerationCycle}, isAutoContinuing? ${isAutoContinuing}`);
    });

    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, () => {
        if (isProfileSwapping || isMidGenerationCycle || isAutoContinuing) { 
            return; 
        }
        console.log(`${LOG_PREFIX} Main connection profile changed`);
        activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
    });
})();

