# Chat Completion Reasoning Profile

A SillyTavern extension that enables two-phase generation for Chat Completion APIs by using different connection profiles for reasoning and response generation.

## Features

- **Dual-Profile Generation**: Automatically swaps between two connection profiles during message generation
- **Reasoning Phase**: Uses a dedicated profile for thinking/chain-of-thought generation
- **Response Phase**: Uses your main profile for the final response
- **Automatic Profile Switching**: Handles profile swaps and generation flow automatically
- **Configurable Settings**: Control reasoning tokens, tags, and behavior options
- **Slash Commands**: Manual control for advanced workflows

## Installation

This extension is installed directly through SillyTavern using the extension installer.

### Method 1: Direct Install (Recommended)

1. Open SillyTavern
2. Go to **Extensions** → **Download Extensions & Assets**
3. Paste the repository URL:
   ```
   https://github.com/Babysworld/ST-CCReasoningProfile
   ```
4. Click **Download**
5. Restart SillyTavern

### Method 2: Manual Install

1. Download or clone this repository
2. Copy the contents to:
   ```
   SillyTavern/public/scripts/extensions/third-party/ST-CCReasoningProfile/
   ```
3. Restart SillyTavern

## Requirements

- **SillyTavern** (latest version recommended)
- **Connection Manager Extension** (required for profile management)
- **Minimum 2 Connection Profiles** configured:
  - One for reasoning/thinking
  - One for response generation
- **Chat Completion API** (OpenAI, Anthropic, Google, OpenRouter, etc.)

## Setup

### 1. Create Connection Profiles

Create at least two connection profiles in SillyTavern's Connection Manager:

**Reasoning Profile:**
- Uses your full character card and context (same as response profile)
- Should include your Custom COT configuration in the preset
- **Important:** Add a system prompt instruction to stop after thinking, e.g.:
  ```
  After providing your thinking in <think> tags, STOP IMMEDIATELY. 
  Do not continue with a character response.
  ```
- Set Max Tokens appropriately in the extension (300-500 recommended)
- This ensures the model only generates thinking, not a full response

**Response Profile:**
- Your main chat profile with your preferred settings
- This is what generates the actual character response using the reasoning

### 2. Configure Extension

1. Open **Extensions** → **Extension Settings**
2. Find **"Chat Completion Reasoning Profile"**
3. Click the power button to enable
4. Select your Reasoning Profile from the dropdown
5. Adjust settings as needed:
   - **Max Reasoning Tokens**: Token limit for reasoning generation (default: 500)
   - **Reasoning Prefix/Suffix**: Tags for reasoning content (default: `<think>` and `</think>`)
   - **Auto-Continue**: Automatically continue to response phase (recommended: ON)
   - **Include Reasoning**: Show or hide reasoning in the final message

### 3. Usage

Once configured, the extension works automatically:

1. Send a message as normal
2. Extension swaps to Reasoning Profile → generates reasoning
3. Extension swaps to Response Profile → generates response
4. Final message displays (with or without visible reasoning)

## Settings

### Basic Settings

- **Power Button**: Enable/disable the extension
- **Reasoning Profile**: Select which connection profile to use for reasoning

### Reasoning Controls

- **Max Reasoning Tokens**: Hard limit on reasoning generation (prevents continuing into full response)
  - Recommended: 300-500 tokens
  - This stops generation after thinking is complete

### Behavior Options

- **Auto-Continue After Reasoning**: Automatically trigger response generation (recommended)
- **Only Trigger When User Last**: Only activate when user sent the last message
- **Include Reasoning in Response**: Show or hide reasoning content in final message

## Slash Commands

The extension provides manual control commands:

```
/CCRP-toggle              Toggle extension on/off
/CCRP-swapToReasoning     Manually swap to reasoning profile
/CCRP-swapToResponse      Manually swap to response profile
```

These commands can be used in Quick Replies or STScript for custom workflows.

## How It Works

1. User sends a message or triggers generation
2. Extension checks if conditions are met (enabled, profiles configured, etc.)
3. **Reasoning Phase**:
   - Swaps to the Reasoning Profile
   - Sends generation request to the reasoning model
   - Extracts reasoning content from the response
4. **Profile Swap**:
   - Swaps back to the original Response Profile
5. **Response Phase** (if Auto-Continue is enabled):
   - Generates the final response using the reasoning as context
6. **Display**: Final message shows response (and optionally reasoning)

## Troubleshooting

### Extension not appearing
- Verify installation directory is correct
- Check that all files are present
- Restart SillyTavern completely

### Profile selector is empty
- Ensure Connection Manager extension is installed
- Create at least one Connection Profile
- Refresh the extension settings page

### Generation not working
- Check power button is enabled (green)
- Verify a Reasoning Profile is selected (not "None")
- Ensure both profiles are properly configured
- Check browser console (F12) for error messages

### Profile swap fails
- Verify profile names are correct
- Check API connections are online
- Look for timeout errors in console
- Ensure no other extensions are interfering

## Technical Details

- **Extension Namespace**: `extension_settings.ccReasoning`
- **Event Listeners**: `GENERATION_STARTED`, `GENERATION_ENDED`, `CONNECTION_PROFILE_LOADED`
- **Profile Swapping**: Uses SillyTavern's `/profile` slash command
- **Reasoning Extraction**: Configurable prefix/suffix tag matching
- **State Management**: Tracks generation phases and profile states

## Compatibility

- **Works with**: All Chat Completion APIs (OpenAI, Anthropic, Google, OpenRouter, etc.)
- **Requires**: Connection Manager extension
- **Compatible with**: Most other SillyTavern extensions
- **Not compatible with**: Extensions that interfere with generation flow or profile management

## Notes

- The extension makes **two API requests** per message (reasoning + response)
- Profile swapping takes 2-3 seconds between phases
- Custom COT settings in your Chat Completion presets are leveraged automatically
- Different profiles can use different APIs for flexibility

## Credits

- **Author**: Babysworld
- **Inspired by**: [Stepped Thinking](https://github.com/cierru/st-stepped-thinking) by Cierru
- **Based on**: Text Completion Reasoning Profile by RossAscends
- **Built for**: [SillyTavern](https://github.com/SillyTavern/SillyTavern)

## License

AGPLv3

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check the SillyTavern Discord
- Review browser console logs (F12) for debugging

---

**Version**: 1.0.0  
**Last Updated**: 2025-10-24
