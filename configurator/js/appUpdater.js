'use strict';

import semver from 'semver';

import GUI from './gui';
import jBox from 'jbox';
import i18n from './localization';

var appUpdater = appUpdater || {};

appUpdater.checkRelease = function (currVersion) {
    var modalStart;
    $.get('https://api.github.com/repos/srt3262/Flight-Commander/releases/latest', function (releaseData) {
        GUI.log(i18n.getMessage('loadedReleaseInfo'));

        let newVersion = releaseData.tag_name;
        let newPrerelase = releaseData.prerelease;

        let updateAvailable = false;
        try {
            updateAvailable = !newPrerelase && semver.gt(newVersion, currVersion);
        } catch (_) {
            // Non-semver version string (e.g. untagged dev builds) — skip update check
        }

        if (updateAvailable) {
            const currentVersion = window.electronAPI.appGetVersion();
            GUI.log(`Flight Commander update available: ${currentVersion} → ${newVersion}`);
            GUI.log(i18n.getMessage('newVersionAvailable'));
            $('#update-notification-download').attr('href', releaseData.html_url);
            modalStart = new jBox('Modal', {
                width: 400,
                height: 200,
                animation: false,
                closeOnClick: false,
                closeOnEsc: true,
                content: $('#appUpdateNotification')
            }).open();
        }
    });

    $('#update-notification-close').on('click', function () {
        modalStart.close();
    });
    $('#update-notification-download').on('click', function () {
        modalStart.close();
    });
};

export default appUpdater;
