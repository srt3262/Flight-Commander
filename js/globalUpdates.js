'use strict'

import CONFIGURATOR from './data_storage';
import FC from './fc';
import { globalSettings } from './globalSettings';
import i18n from './localization';
import {
    FLIGHT_COMMANDER_DOCUMENTATION_FILE_BASE_URL,
    FLIGHT_COMMANDER_REPOSITORY_URL,
} from './flightCommander/documentation';

var update = {

    activatedTab: function() {
        var activeTab = $('#tabs > ul li.active');
        activeTab.removeClass('active');
        $('a', activeTab).trigger('click');
    },

    firmwareVersion: function() {
        globalSettings.docsTreeLocation = FLIGHT_COMMANDER_DOCUMENTATION_FILE_BASE_URL;
        globalSettings.configuratorTreeLocation = `${FLIGHT_COMMANDER_REPOSITORY_URL}/blob/main/`;

        if (CONFIGURATOR.connectionValid) {
            const fork = FC.CONFIG.flightCommanderFirmware;
            const identity = fork
                ? `Flight Commander Firmware ${fork.firmwareVersion ?? 'unknown'}`
                : `Official INAV compatibility mode ${FC.CONFIG.flightControllerVersion}`;
            $('#logo .firmware_version').text(`${identity} [${FC.CONFIG.target}]`);
        } else {
            $('#logo .firmware_version').text(i18n.getMessage('fcNotConnected'));
        }
    }
};

export default update;
