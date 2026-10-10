# Script to duplicate the entire build into a standalone zip file

$dest = "C:\Users\HP\.gemini\antigravity\scratch\mainstreet-build.zip"
$sourceDir = "C:\Users\HP\.gemini\antigravity\scratch\tradexedge-clone"
$tempDir = "C:\Users\HP\.gemini\antigravity\scratch\build-temp"

if (Test-Path $dest) { Remove-Item $dest -Force }
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Copying build files to staging area..."
Get-ChildItem -Path $sourceDir -Force | Where-Object { 
    $_.Name -notin @('node_modules', '.git', 'scratch', 'build-temp', 'mainstreet-build.zip') 
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
}

Write-Host "Compressing into archive..."
Compress-Archive -Path "$tempDir\*" -DestinationPath $dest -CompressionLevel Optimal

# Copy to source root as well
Copy-Item -Path $dest -Destination "$sourceDir\mainstreet-build.zip" -Force

# Clean up temp staging directory
Remove-Item $tempDir -Recurse -Force

$zipItem = Get-Item $dest
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)
Write-Host "SUCCESS: Created $dest ($sizeMB MB)"
