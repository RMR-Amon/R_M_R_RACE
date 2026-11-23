; Windows installer additions: allow the game through Windows Firewall on private networks,
; so other computers on the LAN can find (UDP 47801) and join (TCP 47800) rooms.
!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="RMR_race LAN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="RMR_race LAN" dir=in action=allow program="$INSTDIR\RMR_race.exe" enable=yes profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="RMR_race LAN"'
!macroend
