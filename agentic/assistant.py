"""Runs Jarvis in one of three ways.

    typed:      you type, Jarvis answers out loud (good for testing).
    enter:      press Enter, talk, and Jarvis stops listening when you stop talking.
    hands-free: say "Hey Jarvis" (or press Enter). The orb appears, you talk, Jarvis answers, and it
                keeps listening for a follow-up until you go quiet or say "that's all". You can
                also say it all at once: "Hey Jarvis, what's new?"
"""
import signal
import threading
import traceback

from .config import settings
from .jarvis import Jarvis
from .voice import WakeWord, chime, load_ears, record_utterance, speak, transcribe


KEEP_ALIVE = "30m"  # keep the AI model in memory between questions, so Jarvis answers quickly


def new_jarvis() -> Jarvis:
    """A Jarvis whose AI model is already loaded, so the first answer is quick too."""
    if settings.provider == "ollama":
        import ollama

        print("Loading the AI model...")
        ollama.generate(model=settings.ollama_model, keep_alive=KEEP_ALIVE)
        return Jarvis(keep_alive=KEEP_ALIVE)
    return Jarvis()


def answer(jarvis: Jarvis, text: str, echo: bool = True) -> str:
    if echo:
        print(f"You: {text}")
    print("(thinking...)")
    try:
        return jarvis.handle(text)
    except ConnectionError:
        return "I can't reach Ollama. Please open the Ollama app."
    except Exception as e:  # keep Jarvis running if one request fails
        print(f"(error: {e!r})")
        return "Sorry, something went wrong with that. Please try again."


def run_typed() -> None:
    jarvis = new_jarvis()
    speak("Hi, I'm Jarvis. Type what you want, or q to quit.")
    while (text := input("\nYou: ").strip()).lower() not in ("q", "quit"):
        if text:
            speak(answer(jarvis, text, echo=False))


def run_enter() -> None:
    jarvis, ears = new_jarvis(), load_ears()
    speak("Hi, I'm Jarvis. Press Enter and talk.")
    while input("\nPress Enter to talk (q then Enter to quit): ").strip().lower() not in ("q", "quit"):
        chime()
        audio = record_utterance()
        text = transcribe(ears, audio) if audio is not None else ""
        speak(answer(jarvis, text) if text else "I didn't hear anything.")


def run_hands_free() -> None:
    from .orb import Orb

    orb = Orb()
    signal.signal(signal.SIGINT, signal.SIG_DFL)  # Ctrl+C quits at once, even while the window is open

    def conversation(jarvis: Jarvis, ears, first: str = "") -> None:
        """first is anything you said with the wake word, like "what's new" in "Hey Jarvis, what's new?"."""
        follow_up = False
        while True:
            if first:
                text, first = first, ""
                orb.set("thinking")
            else:
                orb.set("listening")
                if not follow_up:
                    chime()
                audio = record_utterance(on_level=orb.level, wait=6.0 if follow_up else 5.0)
                if audio is None:
                    return
                orb.set("thinking")
                text = transcribe(ears, audio)
                if not text:
                    return
            said = answer(jarvis, text)
            orb.set("speaking")
            speak(said)
            if jarvis.last_action == "goodbye":
                return
            follow_up = True

    now = threading.Event()  # set when you press Enter, as a backup for the wake word

    def keyboard() -> None:
        while input().strip().lower() not in ("q", "quit"):
            now.set()
        orb.close()

    def main() -> None:
        try:
            jarvis, ears = new_jarvis(), load_ears()
            wake = WakeWord(ears)
            threading.Thread(target=keyboard, daemon=True).start()
            print('\nJarvis is ready. Say "Hey Jarvis", or press Enter to talk. Type q and Enter to quit.')
            while True:
                first = wake.wait(now)
                now.clear()
                conversation(jarvis, ears, first)
                orb.set("hidden")
        except Exception:
            traceback.print_exc()
            orb.close()

    orb.start(main)
