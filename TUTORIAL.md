# Build Your First Game with Prompts

This tutorial teaches you how to understand and improve **Starlight Run** one small step at a time. You do not need to know everything before you begin. Read a lesson, use the prompt, test the result, and write down what you learned in Obsidian.

## 0. Setup

1. Open this folder in VS Code.
2. Open `index.html` in a browser. A local server is optional because the game has no dependencies.
3. Open `First lesson.md` in Obsidian. Use it as your progress checklist.
4. Before asking an AI to edit code, make a copy or commit your working version with Git.

## How to use a prompt well

A good prompt includes:

- the learner's level
- the exact file and function
- one requested change
- constraints, such as "keep the existing controls"
- a request for an explanation and a test checklist

After every change, play the game and check the browser console for errors. Ask the AI to explain code you do not understand instead of accepting a large rewrite.

## Lesson 1: Understand the project

**Goal:** Find the three layers of the game.

- HTML creates the button, score labels, canvas, and message.
- CSS controls the layout and visual style.
- JavaScript stores game data, responds to input, updates objects, and draws the canvas.

**Prompt:**

> I am a beginner learning HTML, CSS, and JavaScript. Inspect `index.html` without changing it. Explain the purpose of the HTML, the main CSS layout rules, and these JavaScript functions: `createGame`, `startGame`, `update`, `draw`, and `loop`. Use simple language and give me five questions to answer after reading.

**Check:** Can you explain what happens when the Start button is clicked?

## Lesson 2: Change one game rule

**Goal:** Change the star reward without breaking the game.

**Prompt:**

> In `index.html`, change the score awarded when the player collects a star from 10 to 25. Make the smallest possible edit. Keep all controls, visuals, and collision behavior unchanged. Explain the changed line and give me a manual test checklist.

**Check:** Collect a star and confirm the score increases by 25.

## Lesson 3: Add a lives system

**Goal:** Give the player three lives. A collision with a shadow removes one life. The game ends at zero lives.

**Prompt:**

> Add a simple three-life system to the existing game in `index.html`. Display the lives beside the score, decrease lives after a shadow collision, and end the game when lives reach zero. Preserve the 30-second timer and existing controls. First describe the smallest implementation plan, then edit only the necessary code. Explain each changed section and list edge cases to test.

**Check:** Touch a shadow repeatedly and verify the life count decreases and the game ends correctly.

## Lesson 4: Add a new star type

**Goal:** Add a blue star worth 30 points, while normal stars remain worth 10.

**Prompt:**

> Extend the existing star objects with a `type` property. Keep normal gold stars worth 10 points and add blue stars worth 30 points. Draw the two types differently and make blue stars less common. Do not rewrite the game loop or change player controls. Show the data change, spawn logic, collision scoring, and drawing changes separately.

**Check:** Both star types appear, and their scores are different.

## Lesson 5: Add difficulty over time

**Goal:** Make the game gradually harder.

**Prompt:**

> Make `Starlight Run` gradually harder during its 30-second round. Every 10 seconds, increase shadow movement speed and spawn frequency slightly. Keep the difficulty fair on small screens. Use the existing `update` function and avoid adding a library. Explain why the chosen values are reasonable and how to test them.

**Check:** Compare the first 10 seconds with the last 10 seconds. The game should feel harder but remain playable.

## Lesson 6: Add sound safely

**Goal:** Add optional sound without external files.

**Prompt:**

> Add a sound toggle to the existing game. Use the browser Web Audio API to create a short sound when a star is collected and a different sound when the player hits a shadow. Keep sound off until the user enables it, avoid autoplay, and do not add external assets. Explain browser audio restrictions and provide a test checklist.

**Check:** Sound starts only after the user enables it and does not throw console errors.

## Lesson 7: Improve the project record

After each lesson, add a dated entry to `GAME.md`:

```md
### YYYY-MM-DD

- What I changed:
- What I learned:
- What did not work:
- What I will try next:
```

**Reflection prompt:**

> Help me reflect on today's game programming lesson. Ask me three questions about the code I changed, one question about a bug or test, and one question about the next feature. Do not answer for me.

## Useful debugging prompts

> The game no longer starts after my last edit. Inspect the current `index.html`, identify the most likely JavaScript error, explain why it happens, and propose the smallest fix. Do not rewrite unrelated code.

> I changed the collision code and stars are not collected. Explain how `distance(lantern, star)` is used, then suggest one `console.log` statement that can confirm whether the collision condition is reached.

> Review only the latest change in `index.html`. Look for broken behavior, mobile layout problems, and missing edge cases. Report findings first, then suggest focused fixes.

## Completion goal

You have completed the beginner course when you can:

- explain the game loop in your own words
- add a small feature without replacing the whole file
- use the browser console to find an error
- test desktop and mobile controls
- record your decisions and results in Obsidian
