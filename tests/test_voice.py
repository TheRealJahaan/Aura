from agentic.voice import FRAME_SECONDS, SpeechEnd, Utterances, speakable, wake_phrase


def frames(seconds: float) -> int:
    return round(seconds / FRAME_SECONDS)


def test_stops_after_you_go_quiet():
    end = SpeechEnd(silence=0.9)
    levels = [0.002] * frames(0.5) + [0.05] * frames(1.5) + [0.002] * frames(2)
    stopped_at = next(i for i, level in enumerate(levels) if end.feed(level))
    assert end.heard
    assert stopped_at == frames(0.5) + frames(1.5) + frames(0.9) - 1


def test_gives_up_when_nobody_talks():
    end = SpeechEnd(wait=5.0)
    assert not any(end.feed(0.002) for _ in range(frames(5.0) - 1))
    assert end.feed(0.002) and not end.heard


def test_say_skips_emojis():
    assert speakable('"Team ZebPay 🐄" says ₹4.95L 🚀') == '"Team ZebPay " says ₹4.95L '


def test_wake_phrase_finds_jarvis_and_the_rest():
    assert wake_phrase("Hey Jarvis, what's new?") == "what's new"
    assert wake_phrase("Hi Jervis.") == ""
    assert wake_phrase("Jarvis") == ""
    assert wake_phrase("okay javis read my emails") == "read my emails"
    assert wake_phrase("hello there") is None


def test_utterances_are_cut_at_pauses_with_the_start_kept():
    import numpy as np

    cutter = Utterances(pause=0.5)
    quiet, loud = np.zeros(1280, dtype=np.float32), np.full(1280, 0.1, dtype=np.float32)
    results = [cutter.feed(quiet, 0.002) for _ in range(10)]
    results += [cutter.feed(loud, 0.1) for _ in range(frames(1.0))]
    results += [cutter.feed(quiet, 0.002) for _ in range(frames(1.0))]
    done = [r for r in results if r is not None]
    assert len(done) == 1 and cutter.idle
    # 4 quiet pieces from before you spoke, the speech, then the pause that ended it
    assert len(done[0]) == 1280 * (4 + frames(1.0) + frames(0.5))
