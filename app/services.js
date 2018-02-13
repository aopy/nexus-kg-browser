/*

Copyright 2017 CNRS

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

Author: Andrew P. Davison, UNIC, CNRS

*/

'use strict';

angular.module('nar')

.service("PathHandler", function() {
    var parser = document.createElement('a');

    var get_instance_type_and_id = function(parts) {
        var type_id = "/" + parts.slice(0, 3).join("/");
        var instance_id = null;
        if (parts.length > 3) {
            instance_id = parts.join("/");
        }
        return {type: type_id, id: instance_id};
    };

    var PathHandler = {
        extract_path_from_uri: function(uri) { // assumes uri is a schema uri, need to generalize
            parser.href = uri;
            var full_path = parser.pathname;
            return get_instance_type_and_id(full_path.split("/").slice(3));
        },
        extract_path_from_location: function(location) {
            return get_instance_type_and_id(location.split("/").slice(1));
        }
    }
    return PathHandler;
})

.factory("KGResource", function($http, $q, PathHandler, bbpOidcSession) {
    var error = function(response) {
        console.log(response);
    };

    return function (collection_uri) {
        console.log("Constructing a resource for " + collection_uri);

        // a constructor for new resources
        var Resource = function (data) {
            angular.extend(this, data);
        };

        var config = {
            Authorization: "Bearer " + bbpOidcSession.token()
        };
        collection_uri += "?deprecated=False";

        var Instance = function(response) {
            var instance = {
                data: response.data,
                id: response.data["@id"],
                context: response.data["@context"],
                attributes: [],
                path: PathHandler.extract_path_from_uri(response.data["@id"])
            };

            var is_valid = function(name) {
                return (['@context', 'deprecated', 'rev', 'links', '@type', '@id'].indexOf(name) < 0);
            };

            for (var attribute in instance.data) {
                // skip loop if the property is from prototype
                if (!instance.data.hasOwnProperty(attribute)) continue;
                if (is_valid(attribute)) {
                    var value = instance.data[attribute];
                    instance.attributes.push({
                        label: attribute,
                        value: value
                    });
                }
            }

            instance.get_label = function() {
                var label = instance.data["@id"];
                if (instance.data.hasOwnProperty('name')) {
                    label = instance.data.name;
                } else if (instance.data.hasOwnProperty('familyName')) {
                    label = instance.data.givenName + " " + instance.data.familyName;
                } else if (instance.data.hasOwnProperty('label')) {
                    label = instance.data.label;
                } else {
                    label = PathHandler.extract_path_from_uri(label).id;
                }
                return label;
            };

            instance.resolveId = function(id) {
                var prefix = id.split(":")[0];
                var suffix = id.split(":")[1];
                if (prefix === "http" || prefix === "https") {
                    return id;
                } else {
                    return instance.context[prefix] + suffix;  // todo: may need to recurse within context to get final URI
                }
            };

            return instance;
        };

        Resource.query = function(filter) {  // todo: this only returns the first 10 items
            if (filter) {
                collection_uri += "&filter=" + encodeURIComponent(JSON.stringify(filter));
            }

            var get_next = function(next, promises) {
                // on retrieving the list of instance URIs, we
                // construct a list of http promises, then ...
                console.log(next);
                return $http.get(next, config).then(
                    function(response) {
                        for (let result of response.data.results) {
                            promises.push($http.get(result.resultId, config));
                        }
                        // check if there's more data to come
                        for (let link of response.data.links) {
                            if (link.rel === "next") {
                                promises = get_next(link.href, promises);
                            }
                        }
                        return promises
                    },
                    error);

            };

            return get_next(collection_uri, []).then(
                function(promises) {
                    // ... when they all resolve, we put the data
                    // into an array, which is returned when the promise
                    // is resolved
                    var instances_promise = $q.all(promises).then(
                        function(responses) {
                            var instances = [];
                            for (let response of responses) {
                                instances.push(Instance(response));
                            }
                            return instances;
                        },
                        error);
                    return instances_promise;
                },
                error);
        }
        return Resource;
    };
})
.service("KGIndex", function($http, PathHandler, bbpOidcSession) {

    var error = function(response) {
        console.log(response);
    };

    var config = {
        Authorization: "Bearer " + bbpOidcSession.token()
    };

    var KGIndex = {
        organizations: function() {
            return $http.get('https://nexus.humanbrainproject.org/v0/organizations/', config).then(
                function(response) {
                    var orgs = [];
                    for (let result of response.data.results) {
                        orgs.push(result.resultId);
                    }
                    return orgs;
                },
                error);
        },
        domains: function() {  // todo: allow to restrict to a specific organization
            return $http.get('https://nexus.humanbrainproject.org/v0/domains/', config).then(
                function(response) {
                    var domains = [];
                    for (let result of response.data.results) {
                        domains.push(result.resultId);
                    }
                    return domains;
                },
                error);
        },
        schema_uris: function() {  // todo: allow to restrict to a specific organization or domain
            var get_next = function(next, schemas) {
                console.log(next);
                return $http.get(next, config).then(
                    function(response) {
                        for (let result of response.data.results) {
                            schemas.push(result.resultId);
                        }
                        // check if there's more data to come
                        for (let link of response.data.links) {
                            if (link.rel === "next") {
                                schemas = get_next(link.href, schemas);
                            }
                        }
                        return schemas
                    },
                    error);
            };

            return get_next('https://nexus.humanbrainproject.org/v0/schemas/?from=0&size=50', []);
        },
        paths: function() {
            var extract_paths = function(schema_uris) {
                var paths = [];
                for (let uri of schema_uris) {
                    paths.push(PathHandler.extract_path_from_uri(uri).type);
                }
                return paths;
            }

            return this.schema_uris().then(
                extract_paths,
                error
            )
        }
    };

    return KGIndex;
})
;