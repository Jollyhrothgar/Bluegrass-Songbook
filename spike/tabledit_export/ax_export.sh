#!/bin/bash
# ax_export.sh TEF NAME — export TEF to <save-panel dir>/NAME.xml, AX actions only.
tef="$1"; name="$2"
open -g -a TablEdit "$tef"
osascript - "$name" "$(basename "$tef")" <<'OSA'
on run argv
  set nm to item 1 of argv
  set wn to item 2 of argv
  tell application "System Events" to tell process "TablEdit"
    repeat 40 times
      if exists window wn then exit repeat
      delay 0.25
    end repeat
    if not (exists window wn) then return "NO-WINDOW"
    click menu item wn of menu 1 of menu bar item "Window" of menu bar 1
    delay 0.3
    click menu item "Export Music XML..." of menu 1 of menu item "Export" of menu 1 of menu bar item "File" of menu bar 1
    repeat 40 times
      if exists window "Save" then exit repeat
      delay 0.2
    end repeat
    set g to splitter group 1 of window "Save"
    set value of text field 1 of g to (nm & ".xml")
    click button "Save" of g
    repeat 40 times
      if exists window "TablEdit" then exit repeat
      delay 0.2
    end repeat
    set msg to "NO-DIALOG"
    if exists window "TablEdit" then
      set msg to value of static text 1 of window "TablEdit"
      click button "OK" of window "TablEdit"
    end if
    delay 0.2
    click menu item wn of menu 1 of menu bar item "Window" of menu bar 1
    click menu item "Close" of menu 1 of menu bar item "Window" of menu bar 1
    return msg
  end tell
end run
OSA
