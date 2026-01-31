import * as vscode from 'vscode';
import * as fs from 'fs';
import { AudioContext } from 'node-web-audio-api';
import { getFilePath } from './get/filePath';
import { settings } from './settings/pluginSettings';
import { loadSettings } from './settings/loadSettings';
import { getToggleCommand } from './commands/toggle';
import { getEnableCommand } from './commands/enable';
import { getDisableCommand } from './commands/disable';
import { getSetVoiceCommand } from './commands/setVoice';
import { getSetVolumeCommand } from './commands/setVolume';
import { VOICE_LIST } from './constants/voiceList';
import { playAudio, cleanupChannels } from './audio';
import { isAlphabetical, isHarmonic } from './charTypeChecks';

export let extensionEnabled = true;
export const setExtensionEnabled = (val: boolean) => (extensionEnabled = val);

// Channel assignments for different sound types
const CHANNEL_MAP = {
    voice: 1,
    melodic: 3,
    sfx: 2,
} as const;

/**
 * ### Assigns a channel number based on the key type.
 * @param key The keyboard input character.
 * @returns {number} The channel number (1 for voice, 2 for SFX, 3 for melodic).
 */
function assignKeyToChannel(key: string): number {
    switch (true) {
        case isAlphabetical(key):
            return CHANNEL_MAP.voice;
        case isHarmonic(key):
            return CHANNEL_MAP.melodic;
        default:
            return CHANNEL_MAP.sfx;
    }
}

let sharedAudioContext: AudioContext | null = null;

/**
 * ### Gets or creates the shared audio context.
 * @returns {AudioContext} The shared audio context instance.
 */
function getSharedAudioContext(): AudioContext {
    if (!sharedAudioContext) {
        sharedAudioContext = new AudioContext();
    }
    return sharedAudioContext;
}

/**
 * Extracts the key character from a text document change event.
 * Handles special cases like tab (multiple spaces) and backspace.
 */
function extractKeyFromEvent(event: vscode.TextDocumentChangeEvent): string {
    let key = event.contentChanges[0].text.replaceAll('\r', '').slice(0, 1);

    // Multiple spaces = tab
    if (/^( ){2,}$/.test(event.contentChanges[0].text)) {
        key = 'tab';
    }

    // Text deletion = backspace
    if (event.contentChanges[0].rangeLength > 0) {
        key = 'backspace';
    }

    return key;
}

/**
 * Validates that the audio file path exists and shows error messages if needed.
 */
function validateAudioFilePath(filePath: string, key: string): boolean {
    if (!fs.existsSync(filePath) && settings.soundOverride) {
        if (settings.soundOverride) {
            vscode.window.showErrorMessage(
                'The provided custom sound does not exist. Please change the soundOverride parameter to a valid path.'
            );
        } else {
            vscode.window.showErrorMessage(
                `An unknown error occurred trying to find the sound file corresponding to key ${key}. Please raise an issue on the GitHub repository with the file path "${filePath}".`
            );
        }
        return false;
    }
    return true;
}


export function activate(context: vscode.ExtensionContext) {
    loadSettings(true);

    getSharedAudioContext();

    vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('vscode-animalese')) return;
        loadSettings(false); // Needed to update the `settings` variable for immediate effect.
    });

    const commands = [
        getToggleCommand(),
        getEnableCommand(),
        getDisableCommand(),
        getSetVoiceCommand(),
        getSetVolumeCommand(),
    ];

    context.subscriptions.push(...commands);

    vscode.workspace.onDidChangeTextDocument((event) => {
        if (!extensionEnabled || !event.contentChanges.length) return;

        handleKeyPress(context, event);
    });
}

export function deactivate() {

    cleanupChannels();

    if (sharedAudioContext) {
        sharedAudioContext.close();
        sharedAudioContext = null;
    }
}

export async function handleKeyPress(
    context: vscode.ExtensionContext,
    event: vscode.TextDocumentChangeEvent
) {
    const key = extractKeyFromEvent(event);

    const filePath = getFilePath(
        context.extensionPath,
        key,
        VOICE_LIST.indexOf(settings.voice),
        settings
    );

    if (!validateAudioFilePath(filePath, key)) {
        return;
    }

    const channel = assignKeyToChannel(key);

    const audioContext = getSharedAudioContext();
    await playAudio(audioContext, filePath, key, channel);
}
