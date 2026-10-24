"""Day 5: your own rules for the inbox agent, kept in rules.txt.

Each line is "<category> <word>", for example "ignore zebpay". When the word appears in the
sender's name or address, the rule decides the category instead of the AI. Our code checks
rules before the AI runs, so a rule is always followed exactly.
"""
from pathlib import Path

CATEGORIES = ("reply_now", "read_later", "ignore")
RULES_FILE = "rules.txt"
HEADER = (
    "# Your rules for the inbox agent, one per line: <category> <word in the sender>\n"
    "# Categories: reply_now, read_later, ignore. Lines starting with # are skipped.\n"
)


def load_rules(path: str = RULES_FILE) -> list[tuple[str, str]]:
    p = Path(path)
    if not p.exists():
        return []
    rules = []
    for line in p.read_text().splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0] in CATEGORIES:
            rules.append((parts[0], parts[1].strip().lower()))
    return rules


def save_rules(rules: list[tuple[str, str]], path: str = RULES_FILE) -> None:
    Path(path).write_text(HEADER + "".join(f"{category} {word}\n" for category, word in rules))


def add_rule(category: str, word: str, path: str = RULES_FILE) -> None:
    """Add a rule, replacing any earlier rule for the same word."""
    word = word.strip().lower()
    rules = [r for r in load_rules(path) if r[1] != word]
    save_rules(rules + [(category, word)], path)


def remove_rule(word: str, path: str = RULES_FILE) -> bool:
    word = word.strip().lower()
    rules = load_rules(path)
    kept = [r for r in rules if r[1] != word]
    save_rules(kept, path)
    return len(kept) < len(rules)


def match_rule(sender: str, rules: list[tuple[str, str]]) -> tuple[str, str] | None:
    sender = sender.lower()
    for category, word in rules:
        if word in sender:
            return category, word
    return None
