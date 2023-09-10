import { pipeline, env } from "@xenova/transformers";
import { CustomCache } from "./cache.js";

env.useBrowserCache = false;
env.useCustomCache = true;
env.allowLocalModels = false;
env.customCache = new CustomCache('transformers-cache');
env.backends.onnx.wasm.numThreads = 1;

// Function to check microphone permission and set micPermissionGranted flag
function checkMicrophonePermission() {
    navigator.permissions.query({name: 'microphone'}).then((permissionStatus) => {
      if (permissionStatus.state === 'denied') {
        chrome.storage.local.set({micPermissionGranted: false});
      } else if (permissionStatus.state === 'granted') {
        chrome.storage.local.set({micPermissionGranted: true});
      }
    });
  }

// Initialize or check the value of micPermissionGranted when the extension is installed or updated
chrome.runtime.onInstalled.addListener(function() {
    console.log("on installed")
    chrome.storage.local.get(['micPermissionGranted'], function(result) {
        // If micPermissionGranted is undefined, initialize it as false
        if (typeof result.micPermissionGranted === 'undefined') {
        chrome.storage.local.set({micPermissionGranted: false});
        }
        
        // Check the current permission
        checkMicrophonePermission();

        // Then, decide whether to open a tab with popup.html based on the value of micPermissionGranted
        if (!result.micPermissionGranted) {
        chrome.tabs.create({
            url: chrome.runtime.getURL("popup.html"),
            active: true
        });
        } 
    });
});
console.log('global') 
chrome.runtime.onMessage.addListener(async function(request) {
    console.log(request)
    switch (request.from) {
        case "inject": 
            console.log("inject")
            chrome.tabs.query({active: true}, tabs => {
                let currentTab = tabs[0]
                let myPrompt = `${request.message}`
                if (currentTab) {
                    chrome.scripting.executeScript({ 
                        target: {tabId: currentTab.id},
                        func: (thePrompt)=> {
                            // TODO: inject prompt into textarea with id="prompt-textarea"
                            // then, activate the button with data-testid="send-button"
                            let textarea = document.getElementById('prompt-textarea');
                            if (textarea) {
        
                                textarea.focus();
                                function setNativeValue(element, value) {
                                    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
                                    const prototype = Object.getPrototypeOf(element);
                                    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        
                                    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
                                        prototypeValueSetter.call(element, value);
                                    } else if (valueSetter) {
                                        valueSetter.call(element, value);
                                    } else {
                                        throw new Error('The given element does not have a value setter');
                                    }
                                }
        
                                setNativeValue(textarea, thePrompt);
                                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                            }
            
                            let sendButton = document.querySelector('[data-testid="send-button"]');
                            if (sendButton) {
                                sendButton.disabled = false;
                            }
                            
                            setTimeout(()=>{
                                sendButton.click();
                            },100)
                        },
                        args: [myPrompt]
                    })
                } else {
                    console.log("none")
                }
            })
            break
        case "transcribe":
            console.log("received")
            const message = request.message;

            //TODO: why is the output empty text? ??

            // Do some work...
            // TODO use message data
            let transcriber = await pipeline('automatic-speech-recognition', 'xenova/whisper-tiny');
            let output = await transcriber(message.audio,  { chunk_length_s: 30, stride_length_s: 5 })
            console.log(output)
            chrome.runtime.sendMessage({ from: "inject", message: output}); 
            /*
            const output = await transcribe(
                message.audio,
                message.model,
                message.multilingual,
                message.quantized,
                message.subtask,
                message.language,
            )  
            
            console.log("complete")
            console.log(output)
            //chrome.runtime.sendMessage({ from: "inject", message: output.text}); 
            */
            break
    }
    
});

// Disable local models

// Define model factories
// Ensures only one model is created of each type
class PipelineFactory {
    static task = null;
    static model = null;
    static quantized = null;
    static instance = null;

    constructor(tokenizer, model, quantized) {
        this.tokenizer = tokenizer;
        this.model = model;
        this.quantized = quantized;
    }

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, {
                quantized: this.quantized,
                progress_callback,
            });
        }

        return this.instance;
    }
}

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
    static task = "automatic-speech-recognition";
    static model = null;
    static quantized = null;
}

const transcribe = async (
    audio,
    model,
    multilingual,
    quantized,
    subtask,
    language,
) => {
    // TODO use subtask and language
    const modelName = `Xenova/whisper-${model}${multilingual ? "" : ".en"}`;

    const p = AutomaticSpeechRecognitionPipelineFactory;
    if (p.model !== modelName || p.quantized !== quantized) {
        // Invalidate model if different
        p.model = modelName;
        p.quantized = quantized;

        if (p.instance !== null) {
            (await p.getInstance()).dispose();
            p.instance = null;
        }
    }

    // Load transcriber model
    let transcriber = await p.getInstance((data) => {
        //console.log("checkup")
        console.log(data)
    });

    const time_precision =
        transcriber.processor.feature_extractor.config.chunk_length /
        transcriber.model.config.max_source_positions;

    // Storage for chunks to be processed. Initialise with an empty chunk.
    let chunks_to_process = [
        {
            tokens: [],
            finalised: false,
        },
    ];

    // TODO: Storage for fully-processed and merged chunks
    // let decoded_chunks = [];

    function chunk_callback(chunk) {
        let last = chunks_to_process[chunks_to_process.length - 1];
        // Overwrite last chunk with new info
        Object.assign(last, chunk);
        last.finalised = true;

        // Create an empty chunk after, if it not the last chunk
        if (!chunk.is_last) {
            chunks_to_process.push({
                tokens: [],
                finalised: false,
            });
        }
    }

    // Inject custom callback function to handle merging of chunks
    function callback_function(item) {
        let last = chunks_to_process[chunks_to_process.length - 1];

        // Update tokens of last chunk
        last.tokens = [...item[0].output_token_ids];

        // TODO optimise so we don't have to decode all chunks every time
        let data = transcriber.tokenizer._decode_asr(chunks_to_process, {
            time_precision: time_precision,
            return_timestamps: true,
            force_full_sequences: false,
        });

        console.log('update')
        console.log(data)
    }

    // Actually run transcription
    let output = await transcriber(audio, {
        // Greedy
        top_k: 0,
        do_sample: false,

        // Sliding window
        chunk_length_s: 30,
        stride_length_s: 5,

        // Language and task
        language: language,
        task: subtask,

        // Return timestamps
        return_timestamps: true,
        force_full_sequences: false,

        // Callback functions
        callback_function: callback_function, // after each generation step
        chunk_callback: chunk_callback, // after each chunk is processed
    }).catch((error) => {
        console.log("error")
        console.log(error)
        return null;
    });

    return output;
};