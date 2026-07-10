Option Explicit

Dim fso, shell, projectDir, electronPath, command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronPath = fso.BuildPath(projectDir, "node_modules\electron\dist\electron.exe")

If Not fso.FileExists(electronPath) Then
    MsgBox "Electron was not found. Run npm install in the project folder first.", vbExclamation, "ChatGPT Multi Pane"
    WScript.Quit 1
End If

shell.CurrentDirectory = projectDir
command = Chr(34) & electronPath & Chr(34) & " " & Chr(34) & projectDir & Chr(34)

shell.Run command, 0, False
