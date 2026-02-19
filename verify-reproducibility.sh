set -e

target_apk="android/app/build/outputs/apk/release/app-release-unsigned.apk"
hashes=()

for i in {1..2}
do
   echo "--------------------------------------"
   echo "Starting build iteration $i..."
   
   bash reproducibility.sh
   
   if [ -f "$target_apk" ]; then
       current_hash=$(shasum -a 256 "$target_apk" | awk '{print $1}')
       hashes+=("$current_hash")
       echo "Iteration $i hash: $current_hash"
       rm "$target_apk"
   else
       echo "❌ ERROR: Build failed. APK not found at $target_apk"
       exit 1
   fi
done

if [ "${hashes[0]}" == "${hashes[1]}" ]; then
    echo "--------------------------------------"
    echo "✅ SUCCESS: Both hashes match: ${hashes[0]}"
else
    echo "--------------------------------------"
    echo "❌ FAILURE: Hashes are inconsistent."
    echo "1: ${hashes[0]}"
    echo "2: ${hashes[1]}"
fi