import { AudioContext, AudioBuffer, AudioBufferSourceNode, GainNode } from 'node-web-audio-api';
import { isMelodic } from './charTypeChecks';
import { settings } from './settings/pluginSettings';
import getAudioData from './get/audioData';

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
 * ### Configures the gain node with volume level and applies falloff behavior if enabled.
 * @param gainNode The gain node to configure.
 * @param audioContext The audio context for timing calculations.
 * @param volume The volume level (0-1) to set.
 */
export function setupVolumeAndFalloff(
    gainNode: GainNode,
    audioContext: AudioContext,
    volume: number
): void {
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

    if (!settings.intonation_disableFalloff) {
        const endTime = audioContext.currentTime + settings.intonation_falloffTime;

        if (settings.intonation_switchToExponentialFalloff) {
            gainNode.gain.exponentialRampToValueAtTime(1e-5, endTime);
        } else {
            gainNode.gain.linearRampToValueAtTime(0, endTime);
        }
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
 * ### Plays an audio buffer through the audio context.
 * @param audioContext The audio context to play the audio in.
 * @param filePath The path to the audio file to play.
 * @param key The keyboard input character that triggered this playback.
 */
export async function playAudio(
    audioContext: AudioContext,
    filePath: string,
    key: string
): Promise<void> {
    const { audioBuffer, delay } = await getAudioData(filePath, audioContext);

    const pitchCents = calculatePitch(key);
    const volume = calculateVolume(key);

    const source = createAudioSource(audioContext, audioBuffer, pitchCents);
    const gainNode = audioContext.createGain();

    setupVolumeAndFalloff(gainNode, audioContext, volume);

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0, delay);

    source.onended = () => {
        audioContext.close();
    };
}

