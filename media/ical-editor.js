// @ts-nocheck
document.addEventListener('DOMContentLoaded', function() {
    const vscode = acquireVsCodeApi();
    
    let calendarEl = document.getElementById('calendar');
    let calendar;
    let currentEvents = []; 
    let selectedEventId = null;

    // Check if libraries are loaded
    if (typeof FullCalendar === 'undefined') {
        showError('FullCalendar library not loaded. Check your internet connection or CSP settings.');
        return;
    }
    if (typeof ICAL === 'undefined') {
        showError('ICAL.js library not loaded. Check your internet connection or CSP settings.');
        return;
    }

    try {
        // Initialize FullCalendar
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            height: '100%',
            editable: true,
            selectable: true,
            selectMirror: true,
            dayMaxEvents: true,
            locale: 'ja',
            buttonText: {
                prev: '‹',
                next: '›',
                today: '今日',
                month: '月',
                week: '週',
                day: '日',
                list: 'リスト'
            },
            
            eventClick: function(info) {
                openModal(info.event);
            },

            select: function(info) {
                openModal(null, info);
            },

            eventDrop: function(info) {
                updateDoc();
            },
            
            eventResize: function(info) {
                updateDoc();
            }
        });

        calendar.render();
    } catch (e) {
        showError('Failed to initialize calendar: ' + e.message);
        console.error(e);
    }

    // Global error handler
    window.onerror = function(msg, url, line, col, error) {
        showError(`JS Error: ${msg} at ${line}:${col}`);
        return false;
    };

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message from extension:', message.type);
        switch (message.type) {
            case 'update':
                const text = message.text;
                parseICal(text);
                break;
        }
    });

    // Request initial state
    console.log('Sending ready message to extension');
    vscode.postMessage({ type: 'ready' });

    function parseICal(content) {
        if (!content) return;
        
        try {
            // Pre-process: Add VALUE=DATE to DTSTART/DTEND if they are only 8 digits
            // Many weather iCal feeds omit this, but ICAL.js is strict.
            // e.g. DTSTART:20260205 -> DTSTART;VALUE=DATE:20260205
            console.log('Pre-processing iCal content for 8-digit dates...');
            content = content.replace(/^(DTSTART|DTEND):(\d{8})$/gm, '$1;VALUE=DATE:$2');

            console.log('Parsing iCal content length:', content.length);
            const jcalData = ICAL.parse(content);
            console.log('jCal Data:', JSON.stringify(jcalData).substring(0, 500) + '...');
            
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents('vevent');
            
            console.log('Found vevent components:', vevents.length);
            
            calendar.removeAllEvents();
            currentEvents = [];

            vevents.forEach((vevent, index) => {
                try {
                    // Use direct property access for more robustness
                    const dtstart = vevent.getFirstPropertyValue('dtstart');
                    const dtend = vevent.getFirstPropertyValue('dtend');
                    const summary = vevent.getFirstPropertyValue('summary') || '(No Title)';
                    const description = vevent.getFirstPropertyValue('description') || '';
                    const location = vevent.getFirstPropertyValue('location') || '';
                    const uid = vevent.getFirstPropertyValue('uid') || 'evt_' + Date.now() + '_' + index;

                    console.log(`Processing Event ${index}: summary="${summary}", start="${dtstart}"`);

                    if (!dtstart) {
                        console.warn(`Event ${index} has no start date, skipping.`);
                        return;
                    }

                    const startDate = dtstart.toJSDate();
                    const isTodayEvent = isSameDay(startDate, new Date());

                    const fcEvent = {
                        id: uid,
                        title: summary,
                        start: startDate,
                        end: dtend ? dtend.toJSDate() : null,
                        allDay: dtstart.isDate,
                        editable: !isTodayEvent, // Prevent dragging/resizing if it's today's event
                        extendedProps: {
                            description: description,
                            location: location,
                            isReadOnly: isTodayEvent
                        }
                    };

                    calendar.addEvent(fcEvent);
                } catch (eventErr) {
                    console.error(`Error parsing individual event ${index}:`, eventErr);
                    showError(`Event ${index} parsing failed: ${eventErr.message}`);
                }
            });
            
        } catch (error) {
            console.error('Error in parseICal:', error);
            showError('Global parse error: ' + error.message);
        }
    }

    function showError(message) {
        const errorEl = document.createElement('div');
        errorEl.style.color = 'red';
        errorEl.style.padding = '20px';
        errorEl.style.backgroundColor = '#ffeeee';
        errorEl.style.border = '1px solid red';
        errorEl.style.margin = '10px';
        errorEl.textContent = 'ERROR: ' + message;
        
        // Append to top of body or calendar container
        const container = document.querySelector('.app-container');
        if (container) {
            container.insertBefore(errorEl, container.firstChild);
        } else {
            document.body.appendChild(errorEl);
        }
    }

    // Modal & Editing
    const modal = document.getElementById('eventModal');
    const closeBtn = document.querySelector('.close');
    const cancelBtn = document.querySelector('.cancel-btn');
    const deleteBtn = document.getElementById('deleteEventBtn');
    const eventForm = document.getElementById('eventForm');
    
    const titleInput = document.getElementById('eventTitle');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const locInput = document.getElementById('eventLocation');
    const descInput = document.getElementById('eventDescription');
    const modalTitle = document.getElementById('modalTitle');

    function openModal(event, selectionInfo) {
        modal.classList.add('show');
        
        if (event) {
            selectedEventId = event.id;
            const isReadOnly = event.extendedProps.isReadOnly;

            modalTitle.textContent = isReadOnly ? 'イベント（閲覧専用）' : 'イベント編集';
            deleteBtn.style.display = isReadOnly ? 'none' : 'block';
            
            // Toggle form accessibility
            const inputs = [titleInput, startInput, endInput, locInput, descInput];
            inputs.forEach(input => input.disabled = isReadOnly);
            const submitBtn = document.querySelector('#eventForm .submit-btn');
            if (submitBtn) {
                submitBtn.style.display = isReadOnly ? 'none' : 'inline-block';
            }

            titleInput.value = event.title;
            startInput.value = toLocalISOString(event.start);
            endInput.value = event.end ? toLocalISOString(event.end) : toLocalISOString(event.start);
            locInput.value = event.extendedProps.location || '';
            descInput.value = event.extendedProps.description || '';
        } else if (selectionInfo) {
            selectedEventId = null;
            modalTitle.textContent = '新規イベント';
            deleteBtn.style.display = 'none';
            
            // Ensure inputs are enabled for new events
            const inputs = [titleInput, startInput, endInput, locInput, descInput];
            inputs.forEach(input => input.disabled = false);
            document.querySelector('#eventForm .submit-btn').style.display = 'inline-block';

            titleInput.value = '';
            let start = selectionInfo.start;
            let end = selectionInfo.end;
            
            startInput.value = toLocalISOString(start);
            endInput.value = toLocalISOString(end);
            
            locInput.value = '';
            descInput.value = '';
        }
    }

    function closeModal() {
        modal.classList.remove('show');
        eventForm.reset();
        selectedEventId = null;
    }

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    window.onclick = function(event) {
        if (event.target == modal) {
            closeModal();
        }
    }

    eventForm.onsubmit = function(e) {
        e.preventDefault();
        
        const eventData = {
            title: titleInput.value,
            start: new Date(startInput.value),
            end: new Date(endInput.value),
            extendedProps: {
                location: locInput.value,
                description: descInput.value
            }
        };

        if (selectedEventId) {
            const event = calendar.getEventById(selectedEventId);
            if (event) {
                event.setProp('title', eventData.title);
                event.setStart(eventData.start);
                event.setEnd(eventData.end);
                event.setExtendedProp('location', eventData.extendedProps.location);
                event.setExtendedProp('description', eventData.extendedProps.description);
            }
        } else {
            calendar.addEvent({
                id: 'evt_' + Date.now(),
                title: eventData.title,
                start: eventData.start,
                end: eventData.end,
                extendedProps: eventData.extendedProps
            });
        }
        
        updateDoc();
        closeModal();
    };

    deleteBtn.onclick = function() {
        if (selectedEventId && confirm('このイベントを削除しますか？')) {
            const event = calendar.getEventById(selectedEventId);
            if (event) {
                event.remove();
            }
            updateDoc();
            closeModal();
        }
    };

    function updateDoc() {
        const events = calendar.getEvents();
        
        // Rebuild ICS
        const comp = new ICAL.Component(['vcalendar', [], []]);
        comp.updatePropertyWithValue('prodid', '-//iCalendar Editor//JP');
        comp.updatePropertyWithValue('version', '2.0');
        
        events.forEach(fcEvent => {
            const vevent = new ICAL.Component('vevent');
            const event = new ICAL.Event(vevent);
            
            event.uid = fcEvent.id;
            event.summary = fcEvent.title;
            event.description = fcEvent.extendedProps.description || '';
            event.location = fcEvent.extendedProps.location || '';
            
            event.startDate = ICAL.Time.fromJSDate(fcEvent.start, true);
            
            if (fcEvent.end) {
                event.endDate = ICAL.Time.fromJSDate(fcEvent.end, true);
            }

            comp.addSubcomponent(vevent);
        });

        const iCalString = comp.toString();
        
        // Send to extension
        vscode.postMessage({
            type: 'update',
            text: iCalString
        });
    }

    function toLocalISOString(date) {
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date - offset)).toISOString().slice(0, 16);
        return localISOTime;
    }

    function isSameDay(d1, d2) {
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }
});
