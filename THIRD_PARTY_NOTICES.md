# Third-party notices

Aura's own code is MIT licensed (see [LICENSE](LICENSE)). It includes or downloads these components, each under its own license.

| Component | Used for | License | Where |
| --- | --- | --- | --- |
| Porcupine model parameters (`porcupine_params.pv`, v4.0) | The wake word engine's English model | Apache-2.0, © Picovoice Inc. | Bundled in `apps/desktop/assets/porcupine/`, from [github.com/Picovoice/porcupine](https://github.com/Picovoice/porcupine) |
| `@picovoice/porcupine-web`, `@picovoice/web-voice-processor` | Wake word detection | Apache-2.0, © Picovoice Inc. | npm dependency. Using it needs a Picovoice AccessKey and follows the [Picovoice terms](https://picovoice.ai/terms-of-use/) |
| `@huggingface/transformers` (transformers.js) | Running Whisper on the Mac | Apache-2.0 | npm dependency |
| Whisper models (for example `Xenova/whisper-base.en`) | Speech to text | MIT, © OpenAI | Downloaded from Hugging Face on first use, not bundled |
| Ollama and the models you pull (for example Qwen3) | The local AI | Ollama: MIT. Qwen3: Apache-2.0 | Installed by you, not bundled |
| Electron | The Mac app | MIT | npm dependency |
| NestJS, Prisma, Zod, googleapis clients and other npm packages | The API and shared code | Their own licenses (mostly MIT and Apache-2.0) | See each package in `node_modules` |

Google, Gmail, Google Calendar, Google Drive, Google Meet and Google Tasks are trademarks of Google LLC. Aura is an independent project and isn't affiliated with or endorsed by Google, Picovoice, OpenAI or Anthropic.
