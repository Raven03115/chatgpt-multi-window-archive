# ChatGPT Multi Window Experiment

This is an archived personal Electron experiment for running multiple official ChatGPT web views using an existing ChatGPT subscription.

## Status

Archived / paused.

This project was created to test whether ChatGPT could be used in a multi-window or multi-pane desktop workspace without using the OpenAI API or third-party platforms.

## What worked

- Loading official ChatGPT inside Electron.
- Preserving login state through an Electron persistent session.
- Opening multiple ChatGPT windows or panes.
- Supporting 1 / 2 / 3 / 4 / 6 pane layouts.
- Using the existing ChatGPT account instead of OpenAI API billing.
- Basic active pane selection.
- Basic active pane visual highlight.
- Partial hiding of the internal ChatGPT sidebar inside right-side panes.

## Why it was archived

The original target could not be implemented reliably:

Keep one official ChatGPT sidebar and let it fully control multiple independent ChatGPT conversation panes, including official sidebar popovers and overlay behavior.

The main limitation is that the official ChatGPT sidebar and each right-side ChatGPT pane run in separate Electron WebContentsView instances. Because they are separate web contents, the official sidebar popovers cannot reliably overlay the right-side panes without causing layout, z-index, or responsive UI issues.

## Current decision

Development is paused.

The project is kept as an archive for possible future reference, in case official ChatGPT later supports better multi-pane behavior or another technical approach becomes available.

## Install

Run:

npm install

## Start

Run:

npm start

Or double-click:

start-chatgpt-multi.bat

## Do not commit

Do not commit:

- node_modules
- cookies
- cache
- local Electron user data
- environment files
- logs
