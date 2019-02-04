import { environment } from './../../../environments/environment.prod';
import { AppConfig } from './../../core/AppConfig';
import { SettingsPage } from './../settings/settings';
import { TranslateService } from '@ngx-translate/core';
import { Keyboard } from '@ionic-native/keyboard/ngx';
import { RoutePlannerPage } from './../route-planner/route-planner';
import { POIDetailsPage } from './../poi-details/poi-details';
import { GeoLatLng, GeoPosition } from './../../model/GeoPosition';
import { POISearchParams } from './../../model/POISearchParams';
import { Utils } from './../../core/Utils';
import { Logging, LogLevel } from './../../services/Logging';
import { JourneyManager } from './../../services/JourneyManager';
import { Mapping } from './../../services/mapping/Mapping';
import { POIManager } from './../../services/POIManager';
import { AppManager } from './../../services/AppManager';

import { Component, OnInit, NgZone, ChangeDetectorRef, ViewChild } from '@angular/core';
import { NavController, Events, Platform, ModalController } from '@ionic/angular';
import { MappingAPI } from '../../services/mapping/interfaces/mapping';
import { PlaceSearch } from '../../components/place-search/place-search';
import { PlaceSearchResult } from '../../model/AppModels';

@Component({
  templateUrl: 'search.html',
  styleUrls: ['./search.scss']
})

export class SearchPage implements OnInit {

  private mapDisplayed: boolean = false;
  private debouncedRefreshResults: any;
  private mapCanvasID: string;

  private initialResultsShown: boolean = false;

  private searchOnDemand: boolean = false;

  poiViewMode: string = 'modal'; // side or modal
  private searchPolyline: string;
  private routePlanningMode: boolean = true;
  sideViewAvailable = false;

  searchKeyword: string = '';
  selectedPOI: any;

  appConfig = new AppConfig();

  @ViewChild(PlaceSearch)
  placeSearchMapPOI: PlaceSearch;

  constructor(
    public appManager: AppManager,
    public nav: NavController,

    public events: Events,
    public translate: TranslateService,
    public platform: Platform,
    public poiManager: POIManager,
    public mapping: Mapping,
    public journeyManager: JourneyManager,
    public zone: NgZone,

    public modalController: ModalController,
    private keyboard: Keyboard,
    public logging: Logging
  ) {

    this.mapCanvasID = 'map-canvas';


    this.mapping.setMapAPI(environment.defaultMapProvider);

  }

  ionViewDidEnter() {
    this.logging.log('Entered search page.', LogLevel.VERBOSE);
    // give input focus to native map
    this.mapping.focusMap();
    this.mapping.updateMapSize();
  }

  ionViewWillLeave() {
    // remove input focus from native map
    this.logging.log('Leavings search page.', LogLevel.VERBOSE);
    this.mapping.unfocusMap();
  }

  getPreferredMapHeight(clientHeight: number): number {
    if (clientHeight == null) {
      clientHeight = Utils.getClientHeight();
    }
    const preferredContentHeight = clientHeight - 56;
    return preferredContentHeight;
  }

  enforceMapHeight(size: any) {
    this.logging.log('Would resize map:' + size.width + ' ' + size.height, LogLevel.VERBOSE);

    this.checkViewportMode();

    const preferredContentHeight = this.getPreferredMapHeight(size[0]);

    if (document.getElementById(this.mapCanvasID).offsetHeight !== preferredContentHeight) {
      document.getElementById(this.mapCanvasID).style.height = preferredContentHeight + 'px';
    }
    if (this.mapping) {
      this.logging.log('Map height:' + preferredContentHeight, LogLevel.VERBOSE);
      this.mapping.updateMapSize();
    }
  }

  checkViewportMode() {
    /*this.logging.log('Checking viewport mode:' + this.appManager.clientWidth);
    if (this.appManager.clientWidth > 1000) {
        this.sideViewAvailable = true;
    } else {
        this.sideViewAvailable = false;
    }

    if (this.sideViewAvailable && this.poiViewMode != 'side') {
        this.poiViewMode = 'side'; //switch to side panel view mode for poi details
    }

    if (!this.sideViewAvailable && this.poiViewMode == 'side') {
        this.poiViewMode = 'modal'; //switch to modal view mode for poi details
    }*/
  }

  async initialiseMapping() {

    await this.platform.ready();

    this.debouncedRefreshResults = Utils.debounce(this.refreshResultsAfterMapChange, 1000, false);

    this.events.subscribe('ocm:mapping:ready', () => {
      if (!this.initialResultsShown) {

        // if start position already set, use that for first search
        if (this.appManager.searchSettings.StartSearchPosition) {
          this.searchOnDemand = true;
          this.debouncedRefreshResults();
        } else {

          // attempt to geolocate user and perform search

          this.locateUser().then(() => {
            this.logging.log('Search: maps ready, showing first set of results');
            // this.debouncedRefreshResults();


          }, (rejection) => {
            this.logging.log('Could not locate user..');

          }).catch(() => {
            this.logging.log('Default search..');
            this.initialResultsShown = true;
            this.debouncedRefreshResults();
          });
        }

      }
    });

    this.events.subscribe('ocm:mapping:zoom', () => { this.debouncedRefreshResults(); });
    this.events.subscribe('ocm:mapping:dragend', () => { this.debouncedRefreshResults(); });
    this.events.subscribe('ocm:poiList:updated', (listType) => { this.showPOIListOnMap(listType); });
    this.events.subscribe('ocm:poiList:cleared', () => {
      this.mapping.clearMarkers();
      this.debouncedRefreshResults();
    });

    this.events.subscribe('ocm:window:resized', (size) => {
      // handle window resized event, updating map layout if required
      if (size != null && size.length > 0) {
        this.enforceMapHeight(size[0]);
      }
    });

    this.events.subscribe('ocm:poi:selected', (args) => {
      // console.log(JSON.stringify(args));
      this.viewPOIDetails(args);
    });


    // switch app to to side view mode if display wide enough
    this.checkViewportMode();


    // if this is cordova, map init can't happen until after platform ready
    // platform ready
    this.mapping.initMap(this.mapCanvasID);


    // TODO:centre map to initial location (last search pos?)

  }

  async ngAfterViewInit() {
    await this.initialiseMapping();
  }

  async ngOnInit() {

    // first start up, get fresh core reference data, then we can start getting POI results nearby
    if (!this.appManager.referenceDataManager.referenceDataLoaded()) {
      this.logging.log('No cached ref dat, fetching ..', LogLevel.VERBOSE);
      this.appManager.api.fetchCoreReferenceData(null).subscribe((res) => {
        this.logging.log('Got refreshed core ref data.', LogLevel.VERBOSE);

      }, (rejection) => {
        this.logging.log('Error fetching core ref data:' + rejection);
      });
    }


  }

  showPOIListOnMap(listType: string) {

    const preferredMapHeight = this.getPreferredMapHeight(null);
    // TODO: vary by list type
    this.mapping.refreshMapView(preferredMapHeight, this.poiManager.poiList, null);

    if (!this.mapDisplayed) {
      // TODO:centre map on first load
      this.mapDisplayed = true;
    }

    this.mapping.updateMapSize();
  }

  getIconForPOI(poi) {
    return Utils.getIconForPOI(poi);
  }

  getPOIByID(poiID) {
    const poiList = this.poiManager.poiList;
    for (let i = 0; i < poiList.length; i++) {
      if (poiList[i].ID === poiID) {
        return poiList[i];
      }
    }
    return null;
  }


  async refreshResultsAfterMapChange() {
    if (!this.searchOnDemand) {
      this.logging.log('Skipping refresh, search on demand disabled..', LogLevel.VERBOSE);
      return;
    } else {
      this.logging.log('Refreshing Results..', LogLevel.VERBOSE);
    }



    // this.appState.isSearchInProgress = true;

    const params = new POISearchParams();
    let mapcentre: GeoPosition = null;

    if (this.appManager.searchSettings.StartSearchPosition) {
      mapcentre = new GeoPosition(this.appManager.searchSettings.StartSearchPosition.latitude, this.appManager.searchSettings.StartSearchPosition.longitude);
      // clear start position after first search
      this.appManager.searchSettings.StartSearchPosition = null;
    } else {
      mapcentre = await this.mapping.getMapCenter().toPromise();
    }

    if (mapcentre && mapcentre.coords.latitude == 0 && mapcentre.coords.longitude == 0) {
      this.logging.log('Map center is zero. No query will be performed', LogLevel.WARNING);
      return;
    }

    if (mapcentre != null) {
      params.latitude = mapcentre.coords.latitude;
      params.longitude = mapcentre.coords.longitude;

      // store this as last known map centre
      this.appManager.searchSettings.LastSearchPosition = new GeoLatLng(mapcentre.coords.latitude, mapcentre.coords.longitude);
    }

    /////
    // params.distance = distance;
    // params.distanceUnit = distance_unit;
    // params.maxResults = this.appConfig.maxResults;
    params.includeComments = true;
    params.enableCaching = true;

    // map viewport search on bounding rectangle instead of map centre

    // for first search discard the bounds and search by radius, subsequent searches use map bounds
    let bounds = await this.mapping.getMapBounds().toPromise();


    if (bounds != null && this.initialResultsShown == true) {

      params.boundingbox = '(' + bounds[0].latitude +
        ',' + bounds[0].longitude + '),(' + bounds[1].latitude +
        ',' + bounds[1].longitude + ')';

      this.logging.log(JSON.stringify(bounds), LogLevel.VERBOSE);

    }

    if (!this.initialResultsShown) {
      // default search distance initially
      params.distance = 100;

    }

    // close zooms are 1:1 level of detail, zoomed out samples less data
    //this.mapping.getMapZoom().subscribe((zoomLevel: number) => {


    /* this.logging.log('map zoom level to be converted to level of detail:' + zoomLevel);
     if (zoomLevel > 10) {
       params.levelOfDetail = 1;
     } else if (zoomLevel > 6) {
       params.levelOfDetail = 3;
     } else if (zoomLevel > 4) {
       params.levelOfDetail = 5;
     } else if (zoomLevel > 3) {
       params.levelOfDetail = 10;
     } else {
       params.levelOfDetail = 20;
     }
*/

    // apply filter settings from search settings
    if (this.appManager.searchSettings != null) {
      if (this.appManager.searchSettings.ConnectionTypeList != null) {
        params.connectionTypeIdList = this.appManager.searchSettings.ConnectionTypeList;
      }

      if (this.appManager.searchSettings.UsageTypeList != null) {
        params.usageTypeIdList = this.appManager.searchSettings.UsageTypeList;
      }

      if (this.appManager.searchSettings.StatusTypeList != null) {
        params.statusTypeIdList = this.appManager.searchSettings.StatusTypeList;
      }

      if (this.appManager.searchSettings.OperatorList != null) {
        params.operatorIdList = this.appManager.searchSettings.OperatorList;
      }

      if (this.appManager.searchSettings.MinPowerKW != null && this.appManager.searchSettings.MinPowerKW > 0) {
        params.minPowerKW = this.appManager.searchSettings.MinPowerKW;
      }
      if (this.appManager.searchSettings.MaxPowerKW != null && this.appManager.searchSettings.MaxPowerKW > 0) {
        params.maxPowerKW = this.appManager.searchSettings.MaxPowerKW;
      }

      if (this.journeyManager.getRoutePolyline() != null) {
        // when searching along a polyline we discard any other bounding box filters etc
        params.polyline = this.journeyManager.getRoutePolyline();
        params.boundingbox = null;
        params.levelOfDetail = null;
        params.latitude = null;
        params.longitude = null;
        // params.distance = this.routeSearchDistance;
      }

    }

    // TODO: use stack of requests as may be multiple in sync
    this.appManager.isRequestInProgress = true;

    this.poiManager.fetchPOIList(params).then(() => {

      this.appManager.isRequestInProgress = false;
      this.initialResultsShown = true;

    });



  }

  viewPOIDetails(data: any) {

    this.logging.log('Viewing/fetching [' + this.poiViewMode + '] POI Details ' + data.poiId);

    this.poiManager.getPOIById(data.poiId, true).then(poi => {

      this.logging.log('Got POI Details ' + poi.ID);

      if (this.poiViewMode === 'modal') {
        this.searchOnDemand = false; // suspend interactive searches while modal dialog active

        this.modalController.create({ component: POIDetailsPage, componentProps: { item: poi } })
          .then(m => {

            m.onDidDismiss().then(() => {
              // should focus map again..
              this.logging.log('Dismissing POI Details.');
              this.mapping.focusMap();
              this.searchOnDemand = true;
            });

            m.present();
          });

        this.mapping.unfocusMap();
      }

      if (this.poiViewMode === 'side') {
        this.selectedPOI = poi;
      }

    }, (err) => {

      this.appManager.showToastNotification('POI Details not available');
    });
  }

  closePOIDetails() {
    this.selectedPOI = null;
  }

  openRoutePlannerModal() {
    this.searchOnDemand = false;

    this.mapping.unfocusMap();

    this.modalController.create({ component: RoutePlannerPage })
      .then(m => {
        m.onDidDismiss().then((data) => {
          // should focus map again..
          this.logging.log('Dismissing Route Planner Details.');
          this.mapping.focusMap();
          this.searchOnDemand = true;
        });

        m.present();
      });
  }

  openSearchOptions() {

    this.searchOnDemand = false;
    this.mapping.unfocusMap();

    this.modalController.create({ component: SettingsPage })
      .then(m => {
        m.onDidDismiss().then((data) => {

          this.mapping.focusMap();
          this.searchOnDemand = true;
        });

        m.present();
      });
  }

  openSideView() {
    this.poiViewMode = 'side';
    this.mapping.updateMapSize();
  }

  closeSideView() {
    this.poiViewMode = 'modal';
    this.mapping.updateMapSize();
  }

  planRoute() {
    this.routePlanningMode = true;
  }

  search(ev) {
    //alert(ev);
    this.placeSearchMapPOI.getPlacesAutoComplete(ev, 'poiSearch')
  }

  locateUser(): Promise<any> {

    const geoPromise = new Promise((resolve, reject) => {
      this.logging.log('Attempting to locate user..');
      navigator.geolocation.getCurrentPosition(resolve, reject);
    }).then((position: any) => {
      this.logging.log('Got user location.');

      this.mapping.updateMapCentrePos(position.coords.latitude, position.coords.longitude, true);


      this.mapping.setMapZoom(15); // TODO: provider specific ideal zoom for 'summary'
      // this.mapping.updateMapSize();

      // this.showPOIListOnMap(null); // show initial map view

      this.searchOnDemand = true;

      this.appManager.searchSettings.StartSearchPosition = new GeoLatLng(position.coords.latitude, position.coords.longitude);

      this.debouncedRefreshResults(); //fetch new poi results based on map viewport
    }).catch((err) => {
      /// no geolocation
      this.logging.log('Failed to get user location.');
      this.appManager.showToastNotification('Your location could not be determined.');

      // use a default location, or the last known search position if known
      let searchPos = new GeoLatLng(37.415328, -122.076575);
      if (this.appManager.searchSettings.LastSearchPosition != null) {
        searchPos = this.appManager.searchSettings.LastSearchPosition;
      }

      this.appManager.searchSettings.LastSearchPosition = searchPos;
      this.mapping.updateMapCentrePos(searchPos.latitude, searchPos.longitude, true);
      this.mapping.setMapZoom(15);

      this.searchOnDemand = true;

      this.debouncedRefreshResults();
      this.mapping.updateMapSize();



    });

    return geoPromise;
  }

  placeSelected(place: PlaceSearchResult) {

    this.logging.log('Got place details:' + place.Title);

    // give map back the input focus (mainly for native map)
    this.mapping.focusMap();

    this.mapping.updateMapCentrePos(place.Location.latitude, place.Location.longitude, true);

    this.debouncedRefreshResults();
    /// this.mapping.setMapZoom(15);
    // this.debouncedRefreshResults();

  }
}
