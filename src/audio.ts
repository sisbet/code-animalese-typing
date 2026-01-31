import { AudioContext, AudioBuffer, AudioBufferSourceNode, GainNode } from 'node-web-audio-api';
import { isMelodic } from './charTypeChecks';
import { settings } from './settings/pluginSettings';
import getAudioData from './get/audioData';

// Channel tracking for managing overlapping sounds
const activeChannels: Map<number, { source: AudioBufferSourceNode; gainNode: GainNode }> = new Map();

/**
 * ### Calculates the pitch detune value in cents based on settings and key type.
 * @param key The keyboard input character.
 * @returns {number} The pitch detune value in cents.
 */
export function calculatePitch(key: string): number {
    const pitchShiftCents = settings.intonation_pitchShift * 100;

    if (isMelodic(key)) {
        return pitchShiftCents;
    }

    // Random pitch variation for non-melodic keys
    const randomVariation = Math.random() * settings.intonation_pitchVariation * 2 -
        settings.intonation_pitchVariation;

    // Uppercase letters get additional pitch boost
    if (settings.intonation_louderUppercase > 0 && /^[A-Z]$/.test(key)) {
        return pitchShiftCents +
            1.5 *
            settings.intonation_pitchVariation *
            (1 + settings.intonation_louderUppercase / 100);
    }

    return pitchShiftCents + randomVariation;
}

/**
 * ### Calculates the volume level based on settings and key type.
 * @param key The keyboard input character.
 * @returns {number} The volume level as a value between 0 and 1.
 */
export function calculateVolume(key: string): number {
    let audioVolume = settings.volume;

    // Uppercase letters get volume boost
    if (settings.intonation_louderUppercase > 0 && /^[A-Z]$/.test(key)) {
        audioVolume = audioVolume * (1 + settings.intonation_louderUppercase / 100);
    }

    return audioVolume / 100; // Convert percentage to 0-1 range
}

/**
 * ### Configures the gain node with volume level and applies natural falloff for melodic sounds.
 * @param gainNode The gain node to configure.
 * @param audioContext The audio context for timing calculations.
 * @param volume The volume level (0-1) to set.
 * @param key The keyboard input character to determine if falloff should be applied.
 */
export function setupVolumeAndFalloff(
    gainNode: GainNode,
    audioContext: AudioContext,
    volume: number,
    key: string
): void {
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

    // Always apply natural falloff to melodic/harmonic sounds (numbers, -, =)

    if (isMelodic(key)) {
        const falloffTime = 0.5; // 500ms natural falloff for melodic sounds
        const endTime = audioContext.currentTime + falloffTime;
        gainNode.gain.exponentialRampToValueAtTime(1e-5, endTime);
    }
}

/**
 * ### Creates and configures an audio source node.
 * @param audioContext The audio context to create the source in.
 * @param audioBuffer The audio buffer to play.
 * @param pitchCents The pitch detune value in cents.
 * @returns {AudioBufferSourceNode} The configured audio source node.
 */
export function createAudioSource(
    audioContext: AudioContext,
    audioBuffer: AudioBuffer,
    pitchCents: number
): AudioBufferSourceNode {
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.detune.value = pitchCents;
    return source;
}

/**
 * ### Cuts off the currently playing sound on a channel with a fade-out.
 * @param channel The channel number to cut off.
 * @param fadeDuration The duration of the fade-out in seconds (default: 0.025).
 */
function cutOffAudioOnChannel(channel: number, fadeDuration: number = 0.025): void {
    const active = activeChannels.get(channel);
    if (!active) {
        return;
    }

    const { source, gainNode } = active;

    const currentVolume = gainNode.gain.value;
    const currentTime = gainNode.context.currentTime;


    gainNode.gain.linearRampToValueAtTime(0, currentTime + fadeDuration);

    setTimeout(() => {
        try {
            source.stop();
        } catch (e) {

        }
        activeChannels.delete(channel);
    }, fadeDuration * 1000);
}

/**
 * ### Plays an audio buffer through the audio context.
 * @param audioContext The audio context to play the audio in.
 * @param filePath The path to the audio file to play.
 * @param key The keyboard input character that triggered this playback.
 * @param channel Optional channel number for managing overlapping sounds (voice sounds use channel 1).
 */
export async function playAudio(
    audioContext: AudioContext,
    filePath: string,
    key: string,
    channel?: number
): Promise<void> {

    if (channel !== undefined) {
        cutOffAudioOnChannel(channel);
    }

    const { audioBuffer, delay } = await getAudioData(filePath, audioContext);

    const pitchCents = calculatePitch(key);
    const volume = calculateVolume(key);

    const source = createAudioSource(audioContext, audioBuffer, pitchCents);
    const gainNode = audioContext.createGain();

    setupVolumeAndFalloff(gainNode, audioContext, volume, key);

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0, delay);


    if (channel !== undefined) {
        activeChannels.set(channel, { source, gainNode });
    }

    source.onended = () => {
        if (channel !== undefined) {
            activeChannels.delete(channel);
        }
    };
}

export function cleanupChannels(): void {
    activeChannels.forEach(({ source, gainNode }, channel) => {
        try {
            gainNode.gain.cancelScheduledValues(gainNode.context.currentTime);
            gainNode.gain.setValueAtTime(0, gainNode.context.currentTime);
            source.stop();
        } catch (e) {
            // Source may have already stopped
        }
        activeChannels.delete(channel);
    });
    activeChannels.clear();
}

