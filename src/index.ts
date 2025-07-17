// DOM Elements
const currentTimeElement = document.getElementById('current-time') as HTMLDivElement;
const alarmTimeInput = document.getElementById('alarm-time') as HTMLInputElement;
const alarmMessageInput = document.getElementById('alarm-message') as HTMLTextAreaElement;
const setAlarmButton = document.getElementById('set-alarm') as HTMLButtonElement;
const stopAlarmButton = document.getElementById('stop-alarm') as HTMLButtonElement;
const alarmStatusElement = document.getElementById('alarm-status') as HTMLDivElement;

// Zonos AI API key
const ZONOS_API_KEY = 'zsk-af1c9078c3dccda5b7806b3d6f8029e427b83157b546f086a49cd27d239d72d6';
// Use HTTP for the API endpoint
const ZONOS_API_URL = 'http://api.zyphra.com/v1/audio/text-to-speech';
// Fallback to a local audio file if the API call fails
const FALLBACK_AUDIO_PATH = 'Voice/mahiru.wav';

// Alarm state
let alarmTime: Date | null = null;
let alarmInterval: number | null = null;
let isAlarmRinging = false;
let audioContext: AudioContext | null = null;
let alarmAudio: HTMLAudioElement | null = null;

// Update the clock every second
function updateClock(): void {
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
async function generateVoice(text: string): Promise<string> {
    // Maximum number of retry attempts
    const MAX_RETRIES = 2;
    let retries = 0;

    while (retries <= MAX_RETRIES) {
        try {
            // Add a timeout to the fetch request to handle connection issues
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            // Wrap the fetch in a try-catch to handle network errors more explicitly
            let response;
            try {
                response = await fetch(ZONOS_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': ZONOS_API_KEY
                    },
                    body: JSON.stringify({
                        text: text,
                        speaking_rate: 15,
                        model: 'zonos-v0.1-hybrid', // Recommended for Japanese
                        language_iso_code: 'ja',
                        mime_type: 'audio/mp3'
                    }),
                    signal: controller.signal
                });
            } catch (fetchError) {
                // Log the specific fetch error
                console.error('Fetch operation failed:', fetchError);

                // Clear the timeout since fetch has already completed/failed
                clearTimeout(timeoutId);

                // Increment retries and check if we should fall back
                retries++;
                if (retries > MAX_RETRIES) {
                    console.log(`Maximum retries (${MAX_RETRIES}) reached. Falling back to local audio.`);
                    alarmStatusElement.textContent += ' (ネットワークエラーのため、ローカル音声を使用しています)';
                    return FALLBACK_AUDIO_PATH;
                }

                // Wait before retrying
                const delay = Math.min(1000 * Math.pow(2, retries - 1), 3000);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Skip the rest of this iteration and try again
            }

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            // The API returns the audio data directly as a blob
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            return audioUrl;
        } catch (error) {
            retries++;

            // More user-friendly error message
            let errorMessage: string;
            if (error instanceof TypeError) {
                errorMessage = 'ネットワークエラー：音声サービスに接続できません';
            } else if (error instanceof Error) {
                errorMessage = `音声生成エラー：${error.message}`;
            } else {
                errorMessage = '不明なエラーが発生しました';
            }
            console.error(`${errorMessage} (試行 ${retries}/${MAX_RETRIES + 1})`);

            // If we've reached max retries or it's a network error, fall back immediately
            if (retries > MAX_RETRIES || 
                error instanceof TypeError || 
                (error instanceof DOMException && error.name === 'AbortError')) {
                console.log('Falling back to local audio file due to network error or timeout');
                alarmStatusElement.textContent += ' (ネットワークエラーのため、ローカル音声を使用しています)';
                return FALLBACK_AUDIO_PATH;
            }

            // Wait before retrying (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, retries - 1), 3000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // If we've exhausted all retries, return the fallback
    console.log('All retry attempts failed. Using local audio file.');
    return FALLBACK_AUDIO_PATH;
}

// Play audio from URL or local file
function playAudio(audioUrl: string): void {
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
            alarmAudio?.play().catch(error => {
                console.error('Error playing audio:', error);
                // If there's an error playing the audio, fall back to beep sound
                createBeepSound();
            });
        });

        // Start loading the audio
        alarmAudio.load();
    } catch (error) {
        console.error('Error setting up audio:', error);
        // Fall back to beep sound if there's an error setting up the audio
        createBeepSound();
    }
}

// Initialize and play alarm sound with voice
async function triggerAlarm(): Promise<void> {
    isAlarmRinging = true;
    stopAlarmButton.disabled = false;
    alarmStatusElement.textContent = 'アラームが鳴っています！';

    // Get current time for the message
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');

    // Generate voice message - use custom message if provided, otherwise use default
    let message: string;
    if (alarmMessageInput.value.trim()) {
        // Use custom message from textarea
        message = alarmMessageInput.value.trim();
    } else {
        // Use default message with current time
        message = `現在の時刻は${hours}時${minutes}分です。起きる時間です。`;
    }

    try {
        // Generate and play voice - will return either API URL or fallback audio path
        const audioUrl = await generateVoice(message);
        playAudio(audioUrl);
    } catch (error) {
        console.error('Error in triggerAlarm:', error);

        // Ultimate fallback to beep sound if everything else fails
        createBeepSound();
    }
}

// Create a beep sound as the ultimate fallback
function createBeepSound(): void {
    alarmInterval = window.setInterval(() => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
function stopAlarm(): void {
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
function setAlarm(): void {
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

    // Check if a custom message is provided
    const customMessage = alarmMessageInput.value.trim();
    if (customMessage) {
        // If custom message is provided, include it in the status (truncate if too long)
        const shortMessage = customMessage.length > 20 
            ? customMessage.substring(0, 20) + '...' 
            : customMessage;
        alarmStatusElement.textContent = `アラームは ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} に設定されています（メッセージ: "${shortMessage}"）`;
    } else {
        // If no custom message, use the default status
        alarmStatusElement.textContent = `アラームは ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} に設定されています（デフォルトメッセージ）`;
    }

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
