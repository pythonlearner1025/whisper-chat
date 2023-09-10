let CONST = {
    SAMPLING_RATE: 16000,
    DEFAULT_AUDIO_URL: "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav",
    DEFAULT_MODEL: "tiny",
    DEFAULT_SUBTASK: "transcribe",
    DEFAULT_LANGUAGE: "english",
    DEFAULT_QUANTIZED: true,
    DEFAULT_MULTILINGUAL: false,
}; 

let mediaRecorder;
var audioChunks = [];
var vToggled = false

function playRecording(audioBlob) {
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
}

function sendBlobs(audioData) {
    // Send the audioBlob to your server
    console.log(audioData)
    if (audioData) {
        const channelData = audioData.getChannelData(0);
        // send message to
        console.log("send msg")
        chrome.runtime.sendMessage({from: "transcribe", message: {
            audio: channelData,
            model: CONST.DEFAULT_MODEL,
            multilingual: CONST.DEFAULT_MULTILINGUAL,
            quantized: CONST.DEFAULT_QUANTIZED,
            subtask: CONST.DEFAULT_SUBTASK,
            language: CONST.DEFAULT_LANGUAGE
        }});
      }
}
// Function to handle microphone permission and recording
function handleRecording(start) {
    if (start) {
        // Request microphone permission
    recordButton.textContent = 'Recording...';
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            // Save to Chrome storage that permission was granted
            chrome.storage.local.set({micPermissionGranted: true});

            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                audioChunks = [] 
                //playRecording(audioBlob); // This will play the audio

                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const reader = new FileReader();
                reader.onload = function(event) {
                    audioContext.decodeAudioData(event.target.result, function(buffer) {
                        sendBlobs(buffer);
                    });
                };
                reader.readAsArrayBuffer(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;
        })
        .catch(err => {
            console.error('Could not get user media:', err);
            alert('Microphone access was denied.');
        });
    } else {
        if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        recordButton.textContent = 'Record';
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {

    let recordButton = document.getElementById('recordButton');

    // Attach event listener to the record button
    recordButton.addEventListener('click', handleRecording);
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'v' && !vToggled) {
        handleRecording(true)
        vToggled = true
    }
})

document.addEventListener('keyup', (event) => {
    if (event.key === 'v' || event.key === "b") {
        handleRecording(false)
        vToggled = false
    }
}) 

chrome.commands.onCommand.addListener((command) => {
    if (command === 'press_record') {
        if (!vToggled) {
        handleRecording(true);
        vToggled = true;
        } 
    }
});


