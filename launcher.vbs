Set WshShell = CreateObject("WScript.Shell")

chemin = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

WshShell.Run """" & chemin & "\start.bat""", 0, False
