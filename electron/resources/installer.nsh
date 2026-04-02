!macro customInstall
  Delete "$DESKTOP\Global Smart CRM.lnk"
  CreateShortCut "$DESKTOP\Global Smart CRM.lnk" "$INSTDIR\Global Smart CRM.exe" "" "$INSTDIR\resources\icon.ico"

  Delete "$SMPROGRAMS\Global Smart CRM.lnk"
  CreateShortCut "$SMPROGRAMS\Global Smart CRM.lnk" "$INSTDIR\Global Smart CRM.exe" "" "$INSTDIR\resources\icon.ico"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Global Smart CRM.lnk"
  Delete "$SMPROGRAMS\Global Smart CRM.lnk"
!macroend
