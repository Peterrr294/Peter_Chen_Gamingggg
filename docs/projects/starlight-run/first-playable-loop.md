# Starlight Run — Building the First Playable Loop

## One-Sentence Concept

Control a lantern through a 30-second night, collect starlight, avoid floating shadows, and earn the highest score possible.

## Project Files

- [Project overview](./overview.md): gameplay, version information, and development log
- [legacy-game.html](../../../legacy-game.html): the current standalone playable page
- [rchive/portfolio/index.html](../../../archive/portfolio/index.html): the preserved presentation website
- [Beginner's Prompting Workbook](../../learning/prompting-and-debugging/beginner-workbook.md): learn and extend the game with AI prompts
- [React Three Fiber Learning Path](../../learning/react-three-fiber/learning-path.md): the current 3D learning process and level-by-level roadmap

## Current Progress

- [x] Built the first playable prototype
- [x] Added scoring and a countdown timer
- [x] Added mouse, touch, WASD, and arrow-key controls
- [x] Saved the local high score
- [ ] Add sound and a combo system
- [ ] Add more levels

## Lesson Record

Today's goal was to finish the smallest version that could run and be played immediately. The first pass focused on four core feedback loops: movement, collection, collision, and the end-of-round result. Pacing can be adjusted after playtesting.

## Playtest Entry

Run `./dev.cmd`, then open `http://localhost:5173/#game` to play the current prototype. Open `archive/portfolio/index.html` separately to view the preserved presentation website.
