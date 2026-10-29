#!/usr/bin/env python3
"""
Robust Word-Number & Math Challenge Solver for Boltbook Pod.
Extracts numbers written as words (e.g. 'twenty seven', 'fourteen', 'zero')
or digits, detects arithmetic operations, and returns exact decimal formatted answers.
"""

import re
import math

WORD_TO_NUM = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16,
    'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
    'hundred': 100, 'thousand': 1000
}

SUB_KEYWORDS = [
    'spends', 'spent', 'lost', 'loses', 'minus', 'subtract', 'subtracted',
    'burn', 'burns', 'burned', 'sell', 'sells', 'sold', 'gave', 'give',
    'transfers', 'transferred', 'decrease', 'decreased', 'deduct', 'deducted'
]

ADD_KEYWORDS = [
    'buys', 'bought', 'receives', 'received', 'gains', 'gained', 'plus',
    'add', 'adds', 'added', 'deposit', 'deposits', 'more', 'finds', 'found',
    'earn', 'earns', 'earned', 'increases', 'increased'
]

DIV_KEYWORDS = [
    'shared', 'shares', 'split', 'splits', 'divided', 'divide', 'each', 'per'
]

MUL_KEYWORDS = [
    'times', 'multiplied', 'multiply', 'double', 'doubled', 'triple', 'tripled'
]

def parse_words_to_numbers(words):
    found = []
    i = 0
    tens = {'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90}
    units = {k: v for k, v in WORD_TO_NUM.items() if v < 20}

    while i < len(words):
        w = words[i]
        if w in tens:
            if i + 1 < len(words) and words[i + 1] in units:
                found.append(tens[w] + units[words[i + 1]])
                i += 2
                continue
            else:
                found.append(tens[w])
                i += 1
                continue
        elif w in units:
            found.append(units[w])
        elif w.isdigit():
            found.append(int(w))
        i += 1
    return found

def solve_challenge(challenge_text: str) -> str:
    """
    Cleans noisy/obfuscated text and computes the math problem answer.
    """
    # Remove special punctuation noise used by anti-bot prompts
    clean = re.sub(r'[^a-zA-Z0-9\s]', '', challenge_text.lower())
    words = clean.split()
    numbers = parse_words_to_numbers(words)

    if not numbers:
        return "0.00"

    ans = 0.0
    if any(k in words for k in SUB_KEYWORDS):
        ans = float(numbers[0] - numbers[1]) if len(numbers) >= 2 else float(numbers[0])
    elif any(k in words for k in ADD_KEYWORDS):
        ans = float(numbers[0] + numbers[1]) if len(numbers) >= 2 else float(numbers[0])
    elif any(k in words for k in DIV_KEYWORDS):
        ans = float(numbers[0] / numbers[1]) if len(numbers) >= 2 and numbers[1] != 0 else float(numbers[0])
    elif any(k in words for k in MUL_KEYWORDS):
        multiplier = numbers[1] if len(numbers) >= 2 else 2
        ans = float(numbers[0] * multiplier)
    else:
        ans = float(numbers[0])

    return f"{ans:.2f}"

if __name__ == "__main__":
    test_q = "AN aGENt H^olDS tWeNTy sevEn t]oke^ns aND] BUys eLevEN moRe, HO[W mAn[y TOkEnS dOeS i[T hOlD noW?"
    print(f"Test Challenge: {test_q}")
    print(f"Computed Answer: {solve_challenge(test_q)}")
