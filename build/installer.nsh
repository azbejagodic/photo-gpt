!define PHOTO_GPT_FIREWALL_RULE "Photo GPT LAN Upload"
!define PHOTO_GPT_FIREWALL_DESC "allow phones on the same private LAN to reach Photo GPT on port 8787"

!macro customInstall
  DetailPrint "Configuring Windows Firewall rule: ${PHOTO_GPT_FIREWALL_RULE}"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${PHOTO_GPT_FIREWALL_RULE}"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${PHOTO_GPT_FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=8787 profile=private enable=yes description="${PHOTO_GPT_FIREWALL_DESC}"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule: ${PHOTO_GPT_FIREWALL_RULE}"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${PHOTO_GPT_FIREWALL_RULE}"'
!macroend
