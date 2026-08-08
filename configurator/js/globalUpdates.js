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
            const identity = FC.CONFIG.flightCommanderFirmware;
            const label = identity
                ? `Flight Commander Firmware ${identity.firmwareVersion ?? 'unknown'}`
                : 'Unsupported firmware';
            $('#logo .firmware_version').text(`${label} [${FC.CONFIG.target || 'unknown target'}]`);
        } else {
            $('#logo .firmware_version').text(i18n.getMessage('fcNotConnected'));
        }
    }
};

export default update;
