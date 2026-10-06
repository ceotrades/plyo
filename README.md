# Plyo

An iOS app that turns workout videos saved on TikTok and Instagram into a training plan you can follow.

I built Plyo to prove I can build a product end to end, not to launch one. It is the answer to "show me a real app you have made" rather than a business I am running.

## The problem it solves

People save workout videos constantly and then never do them. The video sits in a saved folder with four hundred others. Nothing about a saved post tells you what to do on Tuesday.

## What it does

You send a saved video into the app. It reads the video, pulls out the exercises, sets and reps, and adds them to a structured plan. From there it builds a training calendar around what you have collected, so the saved posts become a week rather than a pile.

Muscle groups are shown on a body map, so you can see what you have been hitting and what you have been skipping.

## How it works

Expo and React Native with expo-router for navigation. Supabase handles auth, the database and the backend, with the heavy lifting in edge functions:

- `extract-workout` takes the video, uses Apify to pull the content down from Instagram, then OpenAI to read the workout out of it
- `generate-calendar` builds the training plan from what has been extracted
- `delete-account` handles account deletion properly, including the data

Secrets live in environment variables, never in the repo.

## Stack

Expo, React Native, expo-router, TypeScript, Supabase (auth, Postgres, edge functions, secure storage), OpenAI, Apify, react-native-body-highlighter, expo-notifications.

## What this demonstrates

Mobile build, third party API orchestration, an AI extraction pipeline that has to cope with messy real input, auth and a database schema, and the parts people skip, like deleting an account and its data properly.

## Status

Built as a portfolio piece. Runs on my own device through Expo. Not on TestFlight, not on the App Store, and not being taken there.
