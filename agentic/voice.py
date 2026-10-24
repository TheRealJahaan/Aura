"""Ears and mouth for Jarvis.

Ears:  the microphone, the "Hey Jarvis" wake word and Whisper (faster-whisper), which turns your
       speech into text on your Mac. Jarvis wakes up in two ways: the openWakeWord model, which is
       instant but was trained on American voices, and Whisper as a backup, which writes down each
       short thing you say so we can look for the word "Jarvis".
Mouth: the Mac's built-in `say` command.
"""
import re
import subprocess
import sys
from collections import deque

from .config import settings

SAMPLE_RATE = 16000  # Whisper and the wake word both listen at 16 kHz
FRAME = 1280  # 80 ms of sound, the piece size the wake-word model expects
FRAME_SECONDS = FRAME / SAMPLE_RATE
HINT = "Jarvis, Gmail, inbox, email, unread, reply, archive, Trash, rule, ignore, LinkedIn, Unstop, ZebPay."


def speakable(text: str) -> str:
    """Drop emojis and symbols that `say` would read out as words."""
    return re.sub(r"[^\w\s.,!?;:'\"()@&%$₹/+-]", "", text)


def speak(text: str) -> None:
    print(f"Jarvis: {text}")
    if sys.platform == "darwin":
        subprocess.run(["say", speakable(text)], check=False)


def chime() -> None:
    """The little sound that tells you Jarvis is listening."""
    if sys.platform == "darwin":
        subprocess.Popen(["afplay", "/System/Library/Sounds/Tink.aiff"])


class SpeechEnd:
    """Decides when you've finished talking, from how loud each 80 ms piece of sound is."""

    def __init__(self, silence: float = 0.9, wait: float = 5.0, longest: float = 15.0, noise: float | None = None):
        self.silence_frames = round(silence / FRAME_SECONDS)  # this much quiet after speech = done
        self.wait_frames = round(wait / FRAME_SECONDS)  # give up if you don't start talking
        self.max_frames = round(longest / FRAME_SECONDS)
        self.noise = noise  # the room's background loudness, if we already know it
        self.heard = False
        self.quiet = 0
        self.frames = 0

    def feed(self, level: float) -> bool:
        """Takes the loudness of the next piece. Returns True when recording should stop."""
        self.frames += 1
        if self.noise is None:
            self.noise = level
        if level > max(self.noise * 3, 0.01):
            self.heard, self.quiet = True, 0
        else:
            self.noise = 0.9 * self.noise + 0.1 * level  # follow the room's background noise
            self.quiet += 1
        if self.frames >= self.max_frames:
            return True
        if not self.heard:
            return self.frames >= self.wait_frames
        return self.quiet >= self.silence_frames


def record_utterance(on_level=None, wait: float = 5.0):
    """Record until you stop talking. Returns the sound, or None if you said nothing."""
    import numpy as np
    import sounddevice as sd

    end, pieces = SpeechEnd(wait=wait), []
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=FRAME) as mic:
        while True:
            data, _ = mic.read(FRAME)
            pieces.append(data[:, 0].copy())
            level = float(np.sqrt(np.mean(data**2)))
            if on_level:
                on_level(level)
            if end.feed(level):
                break
    return np.concatenate(pieces) if end.heard else None


def load_ears():
    from faster_whisper import WhisperModel

    print(f"Loading the speech model {settings.whisper_model} (the first time downloads it)...")
    return WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")


def transcribe(ears, audio, quick: bool = False) -> str:
    """Speech to text. quick=True trades a little accuracy for speed (used for the wake-word backup)."""
    segments, _ = ears.transcribe(audio, language="en", initial_prompt=HINT, beam_size=1 if quick else 5)
    return " ".join(segment.text.strip() for segment in segments).strip()


SILENT = 30  # a 16-bit sample this quiet is basically zero: the Mac is giving us no sound at all
NO_SOUND = ("I'm getting no sound from the microphone. Allow it in System Settings > Privacy & Security > "
            "Microphone (turn on Terminal), then quit Terminal and open it again.")
# "Jarvis" as Whisper may write it: "Hey Jarvis", "hi Jervis", "Javis"...
WAKE = re.compile(r"\b(?:(?:hey|hi|hello|ok|okay)[\s,]+)?j[ae]r?v[aeiy]s\b", re.I)


def wake_phrase(text: str) -> str | None:
    """If the text has "Jarvis" in it, returns what you said after it (maybe ""). Otherwise None."""
    found = WAKE.search(text)
    return text[found.end():].strip(" ,.!?") if found else None


class Utterances:
    """Cuts the microphone's sound into utterances: from when you start talking until you pause."""

    def __init__(self, pause: float = 0.5, longest: float = 6.0):
        self.pause, self.longest = pause, longest
        self.noise = None  # the room's background loudness
        self.end = None  # a SpeechEnd while you are talking
        self.pieces = []
        self.before = deque(maxlen=4)  # the 0.3 s before you started, so the first word isn't cut off

    @property
    def idle(self) -> bool:
        return self.end is None

    def feed(self, piece, level: float):
        """Takes the next 80 ms of sound (float32) and its loudness. Returns a finished utterance, or None."""
        if self.end is None:
            if self.noise is None or level <= max(self.noise * 3, 0.01):
                self.noise = level if self.noise is None else 0.9 * self.noise + 0.1 * level
                self.before.append(piece)
                return None
            self.end = SpeechEnd(silence=self.pause, wait=self.longest, longest=self.longest, noise=self.noise)
            self.pieces = list(self.before)
        self.pieces.append(piece)
        if not self.end.feed(level):
            return None
        import numpy as np

        self.end = None
        return np.concatenate(self.pieces)


class WakeWord:
    """Listens for "Hey Jarvis": the openWakeWord model first, with Whisper as the backup."""

    def __init__(self, ears=None, threshold: float | None = None):
        import openwakeword
        from openwakeword.model import Model

        print("Loading the wake word (the first time downloads it)...")
        openwakeword.utils.download_models(["hey_jarvis"])
        self.model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        self.threshold = settings.wake_threshold if threshold is None else threshold
        self.ears = ears  # Whisper, for the backup

    def score(self, frame) -> float:
        """How sure the model is that this moment ends with "Hey Jarvis", from 0 to 1."""
        return max(self.model.predict(frame).values())

    def heard(self, utterance) -> str | None:
        """Whisper's backup check: what you said after "Jarvis", or None if you didn't say it."""
        return wake_phrase(transcribe(self.ears, utterance, quick=True)) if self.ears is not None else None

    def wait(self, now=None) -> str:
        """Returns when it hears "Hey Jarvis", or when the `now` event is set (you pressed Enter).

        If you said more in the same breath, like "Hey Jarvis, what's new?", it returns the rest
        ("what's new"), so Jarvis can answer straight away. Otherwise it returns "".
        """
        import numpy as np
        import sounddevice as sd

        self.model.reset()
        cutter, woke = Utterances(), False
        frames, loudest = 0, 0
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME) as mic:
            while not (now and now.is_set()):
                data, _ = mic.read(FRAME)
                frames += 1
                loudest = max(loudest, int(abs(data).max()))
                if frames == round(3 / FRAME_SECONDS) and loudest < SILENT:
                    print(NO_SOUND)
                woke = woke or self.score(data[:, 0]) > self.threshold
                sound = data[:, 0].astype(np.float32) / 32768
                utterance = cutter.feed(sound, float(np.sqrt(np.mean(sound**2))))
                if woke and cutter.idle and utterance is None:
                    return ""  # the model heard it and you've stopped talking
                if utterance is not None:
                    rest = self.heard(utterance)
                    if rest is not None or woke:
                        return rest or ""
        return ""


def mic_check(seconds: float = 12.0) -> None:
    """Shows what Jarvis hears: how loud the microphone is, the wake-word score and what Whisper writes down."""
    import numpy as np
    import sounddevice as sd

    wake = WakeWord(load_ears())
    print(f'\nSay "Hey Jarvis" a few times in the next {seconds:.0f} seconds, with a short pause after each...\n')
    cutter, window = Utterances(), []
    best, loudest, said, woke_by_whisper = 0.0, 0, 0, 0
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME) as mic:
        for _ in range(round(seconds / FRAME_SECONDS)):
            data, _ = mic.read(FRAME)
            score = float(wake.score(data[:, 0]))
            sound = data[:, 0].astype(np.float32) / 32768
            level = float(np.sqrt(np.mean(sound**2)))
            loudest, best = max(loudest, int(abs(data).max())), max(best, score)
            window.append((level, score))
            if len(window) == 6:  # print about twice a second
                bar = "#" * min(40, int(max(lv for lv, _ in window) * 400))
                print(f"  sound {bar:<40}  Hey Jarvis model {max(sc for _, sc in window):.2f}")
                window = []
            utterance = cutter.feed(sound, level)
            if utterance is not None:
                text = transcribe(wake.ears, utterance, quick=True)
                wakes = wake_phrase(text) is not None
                said, woke_by_whisper = said + 1, woke_by_whisper + wakes
                print(f'  Whisper heard: "{text}"' + ("   <- wakes Jarvis" if wakes else ""))
    print()
    if loudest < SILENT:
        print(NO_SOUND)
        return
    print(f"Wake-word model: best score {best:.2f} (it wakes at {wake.threshold}).")
    print(f"Whisper backup: woke on {woke_by_whisper} of the {said} things you said.")
    if best > wake.threshold or woke_by_whisper:
        print("It works. Start Jarvis with: python -m agentic.cli jarvis")
    else:
        print("Neither caught it. Try saying it a little slower and closer to the Mac.")
