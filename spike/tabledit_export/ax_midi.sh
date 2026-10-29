#!/bin/bash
# ax_midi.sh TEF NAME — Rich-MIDI export of TEF to ~/Documents/NAME.mid (TablEdit frontmost).
tef="$1"; name="$2"
open -a TablEdit "$tef"
osascript - "$name" "$(basename "$tef")" <<'OSA'
on run argv
  set nm to item 1 of argv
  set wn to item 2 of argv
  with timeout of 60 seconds
  tell application "TablEdit" to activate
  tell application "System Events" to tell process "TablEdit"
    repeat 40 times
      if exists window wn then exit repeat
      delay 0.25
    end repeat
    if not (exists window wn) then return "NO-WINDOW"
    if exists window "MIDI Export" then click button "Close" of window "MIDI Export"
    click menu item wn of menu 1 of menu bar item "Window" of menu bar 1
    delay 0.4
    click menu item "Export MIDI..." of menu 1 of menu item "Export" of menu 1 of menu bar item "File" of menu bar 1
    repeat 40 times
      if exists window "Export" then exit repeat
      delay 0.2
    end repeat
    set g to splitter group 1 of window "Export"
    set value of text field 1 of g to (nm & ".mid")
    click button "Save" of g
    repeat 40 times
      if exists window "MIDI Export" then exit repeat
      delay 0.2
    end repeat
    set w to window "MIDI Export"
    if value of checkbox "Rich Tablature Midi File" of w is 0 then click checkbox "Rich Tablature Midi File" of w
    click button "Export" of w
    repeat 40 times
      if exists window "TablEdit" then exit repeat
      delay 0.2
    end repeat
    set msg to "NO-DIALOG"
    if exists window "TablEdit" then
      set msg to value of static text 1 of window "TablEdit"
      click button 1 of window "TablEdit"
    end if
    delay 0.3
    if exists window "MIDI Export" then click button "Close" of window "MIDI Export"
    click menu item wn of menu 1 of menu bar item "Window" of menu bar 1
    click menu item "Close" of menu 1 of menu bar item "Window" of menu bar 1
    return msg
  end tell
  end timeout
end run
OSA
