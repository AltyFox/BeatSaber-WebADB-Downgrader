import React, {useState, useEffect} from "react"
import {Box, Button, Flex, FormControl, FormLabel, Heading} from "@chakra-ui/react"
import ModalForm from "./ModalForm"
import FilePicker from "./FilePicker"
import ErrorMessage from "./ErrorMessage"
import streamSaver from 'streamsaver'
import * as ponyfill from 'web-streams-polyfill/ponyfill'
import QuestAdbUtils from './utils/QuestAdbUtils';
import * as zip from '@zip.js/zip.js';
import * as Axml2Xml from 'axml2xml';
export default function PatchForm() {
  const [sourceFile, setSourceFile] = useState(null)
  const [patchFile, setPatchFile] = useState(null)
  const [sourceInvalid, setSourceInvalid] = useState(false)
  const [patchInvalid, setPatchInvalid] = useState(false)
  const [running, setRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [extraErrorMessage, setExtraErrorMessage] = useState(null)
  const [dgVersions, setDgVersions] = useState([])

  var adbUtils = new QuestAdbUtils();

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const response = await fetch("https://raw.githubusercontent.com/ComputerElite/APKDowngrader/main/versions.json")
        const data = await response.json()
        setDgVersions(data)
        console.log(data);
      } catch (error) {
        console.error("Error fetching versions:", error)
      }
    }
    fetchVersions()


  }, [])

  const getCompatibleDowngrades = async () => {
    const installedVersion = await getInstalledVersion();
    const installedBytes = await getBytesOfInstalledApk();
    const compatibleDowngrades = dgVersions.versions.filter(version => version.SV === installedVersion && version.SourceByteSize === installedBytes);
    console.log('Compatible downgrades:', compatibleDowngrades);
    return compatibleDowngrades;
  }

  const getBytesOfInstalledApk = async () => {
    const apkPath = await getApkPath();
    if (apkPath) {
      const bytesCommand = `du -b ${apkPath} | awk '{print $1}'`;
      console.log(bytesCommand);
      const bytesResult = await adbUtils.runCommand(bytesCommand);
      const bytes = parseInt(bytesResult.trim());
      console.log('Bytes of installed APK:', bytes);
      return bytes;
    } else {
      console.log('Beatsaber APK path not found');
    }
  }

  const getInstalledVersion = async () => {
    const dumpsysCommand = 'dumpsys package com.beatgames.beatsaber'
    const dumpsysResult = await adbUtils.runCommand(dumpsysCommand)
    const versionRegex = /versionName=(\S+)/
    const match = dumpsysResult.match(versionRegex)
    if (match) {
      const installedVersion = match[1]
      console.log('Installed version:', installedVersion)
      return installedVersion;
      // Do something with the installed version
    } else {
      console.log('Unable to retrieve installed version')
      // Handle case when version information is not available
    }
  }

  const getApkPath = async () => { 
    const command = 'pm path com.beatgames.beatsaber'
    const result = await adbUtils.runCommand(command)
    console.log(result)
    if (result.includes('package:')) {
      const apkPath = result.replace('package:', '').trim()
      console.log('Beatsaber APK path:', apkPath)
      return apkPath;
    }
  }

  const patchAndInstall = async () => {
    const compatibleDowngrades = await getCompatibleDowngrades();
    console.log(compatibleDowngrades);
    if (compatibleDowngrades.length > 0) {
      const downloadUrl = compatibleDowngrades[0].download;
      const response = await fetch(downloadUrl);
      const patchData = new Uint8Array(await response.arrayBuffer());
      const apkData = new Uint8Array(await downloadApk());
      
      setSourceInvalid(!apkData)
      setPatchInvalid(!patchData)
      if (!apkData || !patchData) {
        return
      }
      setRunning(true)
      setErrorMessage(null)
      setExtraErrorMessage(null)
      const worker = new Worker('./xdelta3.worker.js')
      window.xdelta3Worker = worker
  
      streamSaver.WritableStream = ponyfill.WritableStream
      streamSaver.mitm = 'mitm.html'
      let fileStream = null
      let writer = null
  
      var patchedName = "downgraded_" + getInstalledVersion() + ".apk";
  
      worker.onmessage = function (e) {
        if (!e.data) {
          return
        }
        const {final} = e.data
        if (!final) {
          if (!fileStream && !writer) {
            fileStream = streamSaver.createWriteStream(patchedName)
            writer = fileStream.getWriter()
          }
          writer.write(e.data.bytes)
          return
        }
        console.log("Got final worker command")
        if (e.data.error) {
          setErrorMessage("Error occurred while patching")
          if (e.data.errorMessage) {
            setExtraErrorMessage(`Details: ${e.data.errorMessage} (code ${e.data.errorCode || "unknown"})`)
          }
          if (fileStream) {
            fileStream.abort()
          }
          if (writer) {
            writer.abort()
          }
        } else {
          writer.close()
        }
        setRunning(false)
      }
      await worker.postMessage({command: "start", sourceFile: apkData, patchFile: patchData})

    } else {
      console.log('No compatible downgrades found');
    }
  }

  const downloadApk = async () => {
    try {
      const apkPath = await getApkPath();
      if (apkPath) {
        const downloadApk = async (apkPath) => {
          try {
            const apkData = await adbUtils.readFile(apkPath)
            return apkData;
            // Download the APK using streamSaver or any other method
            // Save the APK file to a desired location
          } catch (error) {
            console.error('Error downloading APK:', error)
          }
        }
        
        if (apkPath) {
          await downloadApk(apkPath)
        }
        // Do something with the APK path
      } else {
        console.log('Beatsaber is not installed')
        // Handle case when Beatsaber is not installed
      }
    } catch (error) {
      console.error('Error checking app installation:', error)
    }
  }

  const init = async () => {
    await adbUtils.init();
  }


    

  return (
    <ModalForm>
      <Button onClick={init}>Initialize</Button>
      <Button onClick={getCompatibleDowngrades}>Check</Button>
      <Button onClick={patchAndInstall}>Patch and Install</Button>
      {errorMessage && <ErrorMessage message={errorMessage} extraMessage={extraErrorMessage}/>}
    </ModalForm>
  )
}
