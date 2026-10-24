"""Day 8: the Siri-style orb.

A small round window that floats above everything at the bottom of your screen while Jarvis is
listening, thinking or speaking. It's a web page (orb.html) shown in a native Mac window by
pywebview, so the look is plain HTML and CSS you can change.
"""
import json
from pathlib import Path

SIZE = 220


class Orb:
    def __init__(self):
        self.window = None

    def start(self, main) -> None:
        """Open the (hidden) orb window and run `main` in the background. Must be called last."""
        import webview

        screen = webview.screens[0]
        self.window = webview.create_window(
            "Jarvis",
            html=(Path(__file__).parent / "orb.html").read_text(),
            width=SIZE,
            height=SIZE,
            x=(screen.width - SIZE) // 2,
            y=screen.height - SIZE - 60,
            frameless=True,
            transparent=True,
            on_top=True,
            hidden=True,
            focus=False,
            easy_drag=True,
        )
        webview.start(main)

    def set(self, state: str) -> None:
        """state is "listening", "thinking", "speaking" or "hidden"."""
        if state == "hidden":
            self.window.hide()
            return
        self.window.evaluate_js(f"setState({json.dumps(state)})")
        self.window.show()

    def level(self, value: float) -> None:
        self.window.evaluate_js(f"setLevel({value:.4f})")

    def close(self) -> None:
        self.window.destroy()


class NoOrb:
    """Stands in for the orb when running without a window."""

    def set(self, state: str) -> None:
        pass

    def level(self, value: float) -> None:
        pass
