"use strict";
// DOM Elements
const currentTimeElement = document.getElementById('current-time');
const alarmTimeInput = document.getElementById('alarm-time');
const setAlarmButton = document.getElementById('set-alarm');
const stopAlarmButton = document.getElementById('stop-alarm');
const alarmStatusElement = document.getElementById('alarm-status');
// Zonos AI API key
const ZONOS_API_KEY = 'zsk-af1c9078c3dccda5b7806b3d6f8029e427b83157b546f086a49cd27d239d72d6';
// Use HTTPS for the API endpoint
const ZONOS_API_URL = 'https://api.zyphra.com/v1/generate/speech';
// Fallback to a local audio file if the API call fails
const FALLBACK_AUDIO_PATH = 'Voice/mahiru.wav';
// Alarm state
let alarmTime = null;
let alarmInterval = null;
let isAlarmRinging = false;
let audioContext = null;
let alarmAudio = null;
// Update the clock every second
function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    currentTimeElement.textContent = `${hours}:${minutes}:${seconds}`;
    // Check if alarm should ring
    if (alarmTime && !isAlarmRinging) {
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const alarmHours = alarmTime.getHours();
        const alarmMinutes = alarmTime.getMinutes();
        if (currentHours === alarmHours && currentMinutes === alarmMinutes && now.getSeconds() < 3) {
            triggerAlarm();
        }
    }
    setTimeout(updateClock, 1000);
}
// Generate voice using Zonos AI API
async function generateVoice(text) {
    // Maximum number of retry attempts
    const MAX_RETRIES = 2;
    let retries = 0;
    while (retries <= MAX_RETRIES) {
        try {
            // Add a timeout to the fetch request to handle connection issues
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            const response = await fetch(ZONOS_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ZONOS_API_KEY}`
                },
                body: JSON.stringify({
                    text: text,
                    voice: 'ja-JP-Standard-A', // Japanese voice
                    speed: 1.0,
                    format: 'mp3'
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            const data = await response.json();
            return data.audio_url; // Assuming the API returns an audio URL
        }
        catch (error) {
            retries++;
            console.error(`Error generating voice (attempt ${retries}/${MAX_RETRIES + 1}):`, error);
            // If we've reached max retries or it's a network error, fall back immediately
            if (retries > MAX_RETRIES ||
                error instanceof TypeError ||
                (error instanceof DOMException && error.name === 'AbortError')) {
                console.log('Falling back to local audio file due to network error or timeout');
                return FALLBACK_AUDIO_PATH;
            }
            // Wait before retrying (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, retries - 1), 3000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    // If we've exhausted all retries, return the fallback
    return FALLBACK_AUDIO_PATH;
}
// Play audio from URL or local file
function playAudio(audioUrl) {
    try {
        if (alarmAudio) {
            alarmAudio.pause();
            alarmAudio = null;
        }
        alarmAudio = new Audio(audioUrl);
        alarmAudio.loop = true;
        // Add event listeners to handle errors
        alarmAudio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            // If there's an error playing the audio, fall back to beep sound
            createBeepSound();
        });
        // Add a canplaythrough event to ensure the audio is loaded before playing
        alarmAudio.addEventListener('canplaythrough', () => {
            alarmAudio === null || alarmAudio === void 0 ? void 0 : alarmAudio.play().catch(error => {
                console.error('Error playing audio:', error);
                // If there's an error playing the audio, fall back to beep sound
                createBeepSound();
            });
        });
        // Start loading the audio
        alarmAudio.load();
    }
    catch (error) {
        console.error('Error setting up audio:', error);
        // Fall back to beep sound if there's an error setting up the audio
        createBeepSound();
    }
}
// Initialize and play alarm sound with voice
async function triggerAlarm() {
    isAlarmRinging = true;
    stopAlarmButton.disabled = false;
    alarmStatusElement.textContent = 'アラームが鳴っています！';
    // Get current time for the message
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    // Generate voice message
    const message = `現在の時刻は${hours}時${minutes}分です。起きる時間です。`;
    try {
        // Generate and play voice - will return either API URL or fallback audio path
        const audioUrl = await generateVoice(message);
        playAudio(audioUrl);
    }
    catch (error) {
        console.error('Error in triggerAlarm:', error);
        // Ultimate fallback to beep sound if everything else fails
        createBeepSound();
    }
}
// Create a beep sound as the ultimate fallback
function createBeepSound() {
    alarmInterval = window.setInterval(() => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 0.5;
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        oscillator.start();
        setTimeout(() => {
            oscillator.stop();
        }, 300);
    }, 1000);
}
// Stop the alarm
function stopAlarm() {
    // Stop interval if it's running
    if (alarmInterval !== null) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    // Stop audio playback if it's playing
    if (alarmAudio) {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
        alarmAudio = null;
    }
    isAlarmRinging = false;
    stopAlarmButton.disabled = true;
    alarmStatusElement.textContent = alarmTime ? 'アラームは設定されています' : 'アラームは設定されていません';
}
// Set the alarm
function setAlarm() {
    const timeValue = alarmTimeInput.value;
    if (!timeValue) {
        alert('時間を設定してください');
        return;
    }
    // Create a Date object for the alarm time
    const [hours, minutes] = timeValue.split(':').map(Number);
    const now = new Date();
    alarmTime = new Date();
    alarmTime.setHours(hours);
    alarmTime.setMinutes(minutes);
    alarmTime.setSeconds(0);
    // If the time has already passed today, set it for tomorrow
    if (alarmTime < now) {
        alarmTime.setDate(alarmTime.getDate() + 1);
    }
    alarmStatusElement.textContent = `アラームは ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} に設定されています（音声通知）`;
    // Stop any currently ringing alarm
    if (isAlarmRinging) {
        stopAlarm();
    }
}
// Event listeners
setAlarmButton.addEventListener('click', setAlarm);
stopAlarmButton.addEventListener('click', stopAlarm);
// Start the clock
updateClock();
